import { execa } from "execa";

import { KernelError, type KvStore } from "@kilo-desktop/kernel";

import { githubRepositoryUrl } from "../../contracts/github-remote";
import type { GithubRepository, GithubRepositoryListing } from "../../contracts/models";
import { ghErrorToKernelError } from "../repository/git-service";
import {
	COMMON_CLONE_FAILURES,
	describeCloneFailure,
	type KnownCloneFailure,
} from "./clone-failures";

const LIST_TIMEOUT_MS = 60_000;
/** Large repositories take a while; the user waits on an explicit "Cloning…" state. */
const CLONE_TIMEOUT_MS = 30 * 60_000;
/** Age after which a served listing triggers a background refresh. */
const STALE_AFTER_MS = 5 * 60_000;
/**
 * Minimum gap between background refreshes, so a failing one is not retried
 * by the re-read its own `onRefreshed` triggers.
 */
const RETRY_AFTER_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 20_000;
/** `gh repo view --json` fields matching {@link GithubRepository}. */
const REPOSITORY_FIELDS = "nameWithOwner,name,description,isPrivate,isArchived,url,pushedAt";
/** Inherited on top of `process.env` (execa's `extendEnv`): a missing credential fails instead of prompting. */
const NO_PROMPTS_ENV = { GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };

/**
 * `ownerAffiliations` defaults to OWNER + COLLABORATOR, which would hide
 * repositories reached only through an organization, so both filters are
 * spelled out.
 */
const REPOSITORIES_QUERY = `query($endCursor: String) {
  viewer {
    repositories(
      first: 100
      after: $endCursor
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      nodes { nameWithOwner name description isPrivate isArchived url pushedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const OWNER_REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]+$/;

const INVALID_REPOSITORY_MESSAGE = "Enter a GitHub repository as owner/name or a URL.";

/**
 * Normalizes user input into an argument `gh repo clone` accepts: `owner/name`
 * stays shorthand, any GitHub remote URL becomes its https form. Returns null
 * for anything else, including strings that could be read as flags.
 */
export function parseCloneTarget(input: string): string | null {
	const trimmed = input.trim();
	const shorthand = trimmed.replace(/\.git$/i, "");
	if (OWNER_REPOSITORY.test(shorthand)) return shorthand;
	return githubRepositoryUrl(trimmed);
}

/** `owner/name` for a clone target, which may be a full GitHub URL. */
function displayName(target: string): string {
	return target.replace(/^https?:\/\/[^/]+\//, "");
}

function isRepository(value: unknown): value is GithubRepository {
	const node = value as Partial<GithubRepository> | null;
	return (
		typeof node?.nameWithOwner === "string" &&
		typeof node.name === "string" &&
		typeof node.url === "string" &&
		typeof node.isPrivate === "boolean" &&
		typeof node.isArchived === "boolean" &&
		(node.description === null || typeof node.description === "string") &&
		(node.pushedAt === null || typeof node.pushedAt === "string")
	);
}

function toRepositories(values: readonly unknown[]): GithubRepository[] {
	const seen = new Set<string>();
	const repositories: GithubRepository[] = [];
	for (const value of values) {
		if (!isRepository(value) || seen.has(value.nameWithOwner)) continue;
		seen.add(value.nameWithOwner);
		const { nameWithOwner, name, description, isPrivate, isArchived, url, pushedAt } = value;
		repositories.push({ nameWithOwner, name, description, isPrivate, isArchived, url, pushedAt });
	}
	return repositories;
}

function parseJsonOrNull(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

function parseRepositoryLines(stdout: string): GithubRepository[] {
	return toRepositories(stdout.split("\n").map(parseJsonOrNull));
}

/** GitHub-specific failures first; the shared ones follow. */
const GITHUB_FAILURES: readonly KnownCloneFailure[] = [
	{
		pattern:
			/Could not resolve to a Repository|Repository not found|repository '.*' not found|HTTP 404/i,
		error: ({ repository }) =>
			new KernelError(
				"NOT_FOUND",
				`GitHub couldn't find ${repository}. Check the name, or make sure your GitHub account has access to it.`,
			),
	},
	{
		pattern: /SAML|single sign-on/i,
		error: () =>
			new KernelError(
				"BUSINESS",
				"This organization requires single sign-on. Run `gh auth refresh` in a terminal to authorize the GitHub CLI for it, then try again.",
			),
	},
	{
		pattern: /Permission denied \(publickey\)|Host key verification failed/i,
		error: () =>
			new KernelError(
				"BUSINESS",
				"Git couldn't sign in to GitHub over SSH. Add an SSH key to your GitHub account, or switch the GitHub CLI to HTTPS with `gh config set git_protocol https`.",
			),
	},
	{
		pattern:
			/gh auth login|Authentication failed|could not read Username|terminal prompts disabled|HTTP 401|Bad credentials|returned error: 403/i,
		error: () =>
			new KernelError(
				"BUSINESS",
				"The GitHub CLI isn't signed in, or its sign-in has expired. Run `gh auth login` in a terminal, then try again.",
			),
	},
	...COMMON_CLONE_FAILURES,
];

/** Turns a failed `gh repo clone` / `gh repo view` into an actionable error. */
export function githubRepositoryFailure(
	stderr: string,
	repository: string,
	fallback: string,
): KernelError {
	return describeCloneFailure(stderr, { repository, host: "GitHub" }, GITHUB_FAILURES, fallback);
}

/** The persisted shape; read back defensively since it comes from disk. */
export type PersistedRepositoryListing = { repositories: unknown[]; fetchedAt: number };

type Listing = Omit<GithubRepositoryListing, "refreshing">;

export interface GithubRepositoryServiceOptions {
	/** Keeps the last listing across launches; absent means memory only. */
	readonly store?: Pick<KvStore<PersistedRepositoryListing>, "snapshot" | "set">;
	/** Called when a refresh settles while a listing is already known (see class comment). */
	readonly onRefreshed?: () => void;
	readonly now?: () => number;
	/**
	 * Settles once the process environment is complete (`environmentReady`):
	 * `gh` is found on PATH, so nothing spawns before this.
	 */
	readonly environmentReady?: () => Promise<void>;
}

/**
 * Lists, looks up and clones the signed-in GitHub CLI user's repositories.
 *
 * Owns the repository listing, which is slow to fetch (a large account pages
 * through several seconds of GraphQL) but changes rarely, so it is served
 * stale-while-revalidate: the last listing is persisted to the plugin's kv
 * store and answered immediately, and once it is older than
 * `STALE_AFTER_MS` a background refresh starts. Only a caller with nothing to
 * show (first launch) or an explicit `refresh` waits on GitHub.
 *
 * Invariants: at most one fetch runs at a time and every caller during it
 * shares the result; a failed fetch never replaces a known listing, so
 * signing in to `gh` and retrying works immediately; background refreshes
 * are spaced at least `RETRY_AFTER_MS` apart. `onRefreshed` fires
 * whenever a fetch settles with a listing known, telling readers that saw
 * `refreshing: true` to re-read; it deliberately stays silent when a fetch
 * fails with nothing known, because the re-read would start another fetch
 * and loop. Lookups and cloning are stateless. Every `gh` spawn waits for
 * the environment to be ready and runs with prompts disabled so a missing
 * credential fails fast instead of hanging on an invisible terminal prompt.
 */
export class GithubRepositoryService {
	readonly #store: GithubRepositoryServiceOptions["store"];
	readonly #onRefreshed: (() => void) | undefined;
	readonly #now: () => number;
	readonly #environmentReady: () => Promise<void>;
	/** `undefined` until the persisted listing has been read once. */
	#listing: Listing | null | undefined = undefined;
	#pending: Promise<Listing> | null = null;
	#lastAttemptAt = Number.NEGATIVE_INFINITY;

	constructor(options: GithubRepositoryServiceOptions = {}) {
		this.#store = options.store;
		this.#onRefreshed = options.onRefreshed;
		this.#now = options.now ?? Date.now;
		this.#environmentReady = options.environmentReady ?? (() => Promise.resolve());
	}

	async list({ refresh = false }: { refresh?: boolean } = {}): Promise<GithubRepositoryListing> {
		const known = this.#known();
		if (refresh || !known) return { ...(await this.#fetch()), refreshing: false };
		const now = this.#now();
		if (now - known.fetchedAt >= STALE_AFTER_MS && now - this.#lastAttemptAt >= RETRY_AFTER_MS) {
			// Failures surface on the next explicit refresh; the known listing stays.
			this.#fetch().catch(() => undefined);
		}
		return { ...known, refreshing: this.#pending !== null };
	}

	async clone(input: { repository: string; destination: string }): Promise<void> {
		const target = parseCloneTarget(input.repository);
		if (!target) throw new KernelError("VALIDATION", INVALID_REPOSITORY_MESSAGE);
		const result = await this.#gh(["repo", "clone", target, input.destination], CLONE_TIMEOUT_MS);
		if (result.exitCode !== 0) {
			throw githubRepositoryFailure(
				String(result.stderr ?? ""),
				displayName(target),
				"The repository could not be cloned.",
			);
		}
	}

	/** Looks one repository up, e.g. to confirm a typed `owner/name` before cloning it. */
	async resolve(repository: string): Promise<GithubRepository> {
		const target = parseCloneTarget(repository);
		if (!target) throw new KernelError("VALIDATION", INVALID_REPOSITORY_MESSAGE);
		const result = await this.#gh(
			["repo", "view", target, "--json", REPOSITORY_FIELDS],
			LOOKUP_TIMEOUT_MS,
		);
		if (result.exitCode !== 0) {
			throw githubRepositoryFailure(
				String(result.stderr ?? ""),
				displayName(target),
				"The repository could not be looked up.",
			);
		}
		const [resolved] = toRepositories([parseJsonOrNull(String(result.stdout ?? ""))]);
		if (!resolved) throw new KernelError("BUSINESS", "GitHub returned an unexpected response.");
		return resolved;
	}

	#known(): Listing | null {
		if (this.#listing === undefined) {
			const stored = this.#store?.snapshot();
			this.#listing =
				stored && stored.fetchedAt > 0 && Array.isArray(stored.repositories)
					? { repositories: toRepositories(stored.repositories), fetchedAt: stored.fetchedAt }
					: null;
		}
		return this.#listing;
	}

	#fetch(): Promise<Listing> {
		if (this.#pending) return this.#pending;
		this.#lastAttemptAt = this.#now();
		const pending = (async () => {
			try {
				const listing = { repositories: await this.#load(), fetchedAt: this.#now() };
				this.#listing = listing;
				this.#store?.set(listing);
				return listing;
			} finally {
				this.#pending = null;
				if (this.#listing) this.#onRefreshed?.();
			}
		})();
		this.#pending = pending;
		return pending;
	}

	async #load(): Promise<GithubRepository[]> {
		const result = await this.#gh(
			[
				"api",
				"graphql",
				"--paginate",
				"-f",
				`query=${REPOSITORIES_QUERY}`,
				"--jq",
				".data.viewer.repositories.nodes[] | @json",
			],
			LIST_TIMEOUT_MS,
		);
		if (result.exitCode !== 0) throw ghErrorToKernelError(result);
		return parseRepositoryLines(String(result.stdout ?? ""));
	}

	async #gh(args: string[], timeout: number) {
		await this.#environmentReady();
		const result = await execa("gh", args, {
			reject: false,
			timeout,
			windowsHide: true,
			env: NO_PROMPTS_ENV,
		}).catch((error: unknown) => {
			throw ghErrorToKernelError(error);
		});
		// With `reject: false` a spawn failure comes back as a result, not a throw.
		if ((result as { code?: string }).code === "ENOENT") throw ghErrorToKernelError(result);
		if ((result as { timedOut?: boolean }).timedOut) {
			throw new KernelError("BUSINESS", "The GitHub CLI took too long to respond.");
		}
		return result;
	}
}
