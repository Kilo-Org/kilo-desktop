import { randomUUID } from "node:crypto";
import { open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { isAbsolute, relative, resolve, sep } from "node:path";

import { execa, type ExecaError } from "execa";
import pLimit from "p-limit";

import type { MainSdkLogger } from "@kilo-desktop/feature-sdk";
import { FeatureError } from "@kilo-desktop/feature-sdk";
import type { GitClient, GitPatchFile } from "@kilo-desktop/git-client";
import {
	GitErrorCode,
	GitFileTooLargeError,
	GitNotDetectedError,
	createGitClient,
	isGitError,
	isMaxBufferExceededError,
} from "@kilo-desktop/git-client";
import { githubRepositoryUrl } from "../contracts/github-remote.js";
import type {
	GitBranch,
	GitBranchesResult,
	GitRepositoryType,
	GitStatus,
	GitWorktreeResult,
} from "../contracts/schemas.js";
import type { IBranch, RepositoryType } from "@kilo-desktop/git-client";
import { findDefaultBranch } from "./find-default-branch.js";
import {
	BATCH_CHUNK_SIZE,
	type BatchNodes,
	batchQueryArgs,
	finderPick,
	parseBatchResponse,
} from "./pull-request-batch.js";
import { WorktreeManager } from "./worktree-manager.js";

export interface GitPullRequest {
	readonly number: number;
	readonly url: string;
	readonly title: string;
	readonly baseBranch: string;
	readonly headBranch: string;
	readonly state: "open" | "closed" | "merged";
	readonly isDraft: boolean;
}

/** A lookup match plus its commits, which stay in the main process. */
interface PullRequestCandidate {
	readonly pullRequest: GitPullRequest;
	readonly headSha: string | null;
	readonly mergeSha: string | null;
}

/** A checkout whose pull request needs a GitHub lookup. */
interface PullRequestLookupPlan {
	readonly kind: "lookup";
	readonly workingDirectory: string;
	readonly branch: string;
	readonly upstream: string | undefined;
	readonly sha: string;
	readonly owner: string | null;
	/** Everything but the pull request, which the lookup decides. */
	readonly snapshot: Omit<GitPullRequestSnapshot, "pullRequest">;
	/** Set when the batched query can serve this checkout. */
	readonly batch: { readonly host: string; readonly upstreamBranch: string | null } | null;
}

/** A checkout whose snapshot is known without asking GitHub. */
interface ResolvedPullRequestLookup {
	readonly kind: "resolved";
	readonly workingDirectory: string;
	readonly snapshot: GitPullRequestSnapshot;
}

/** Whether a PR head names this checkout's branch or its upstream. */
function isOwnHead(headRefName: unknown, branch: string, upstream: string | undefined): boolean {
	return (
		typeof headRefName === "string" &&
		(headRefName === branch || upstream?.endsWith(`/${headRefName}`) === true)
	);
}

const REMOTE_REF_PREFIX = "refs/remotes/";
const BRANCH_REF_PREFIXES = ["refs/heads", "refs/remotes"] as const;
/** The only remote this plugin's default-branch detection looks at (no fork model). */
const DEFAULT_REMOTE_NAME = "origin";
const PULL_REQUEST_TEMPLATE_PATHS = [
	".github/pull_request_template.md",
	".github/PULL_REQUEST_TEMPLATE.md",
	"pull_request_template.md",
	"PULL_REQUEST_TEMPLATE.md",
	"docs/pull_request_template.md",
	"docs/PULL_REQUEST_TEMPLATE.md",
] as const;
const PULL_REQUEST_TEMPLATE_DIRECTORIES = [
	".github/PULL_REQUEST_TEMPLATE",
	"PULL_REQUEST_TEMPLATE",
	"docs/PULL_REQUEST_TEMPLATE",
] as const;
const PULL_REQUEST_TEMPLATE_MAX_CHARS = 8_000;
const PULL_REQUEST_FIELDS = "number,url,title,baseRefName,headRefName,state,isDraft,updatedAt";
/** Lookups also read the commits that tie a pull request to a checkout's history. */
const PULL_REQUEST_LOOKUP_FIELDS = `${PULL_REQUEST_FIELDS},headRefOid,mergeCommit`;
/** Commit ids from `gh` become git arguments, so only hex object names pass. */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
/** Budgets for model-bound Git context: summaries and the patch itself. */
const SUMMARY_MAX_CHARS = 20_000;
const PATCH_MAX_CHARS = 60_000;
const GH_TIMEOUT_MS = 20_000;
/** Local probes a batched PR lookup runs at once before its single `gh` request. */
const BATCH_PLAN_CONCURRENCY = 4;
const GH_PROBE_SUCCESS_TTL_MS = 300_000;
const GH_PROBE_FAILURE_TTL_MS = 30_000;
const FETCH_THROTTLE_MS = 60_000;
const REPOSITORY_IDENTITY_TTL_MS = 5 * 60_000;
const REPOSITORY_IDENTITY_FAILURE_TTL_MS = 30_000;
const REPOSITORY_IDENTITY_CACHE_LIMIT = 100;
const UNTRACKED_STATS_MAX_FILES = 500;
const UNTRACKED_STATS_MAX_BYTES = 1024 * 1024;

type GithubCliStatus = "ready" | "missing" | "unauthenticated" | "timeout" | "error";
/** `unsupported`: no branch, or an origin the GitHub CLI cannot serve. */
type GithubSnapshotStatus = GithubCliStatus | "unsupported";

export interface GitPullRequestSnapshot {
	readonly identity: string | null;
	readonly branch: string | null;
	readonly repository: string | null;
	readonly parentRepository: string | null;
	readonly pullRequest: GitPullRequest | null;
	readonly githubStatus: GithubSnapshotStatus;
}
/** The max number of recent branches to report (GitHub Desktop's `RecentBranchesLimit`). */
const RECENT_BRANCHES_LIMIT = 5;
const DEFAULT_BRANCH_CONFIG_KEY = "init.defaultBranch";

function branchKind(ref: string): GitBranch["kind"] {
	return ref.startsWith(REMOTE_REF_PREFIX) ? "remote" : "local";
}

/** Drop remotes that a local branch already tracks (same short name as `upstream`). */
function visibleBranches(branches: ReadonlyArray<IBranch>): GitBranch[] {
	const localUpstreams = new Set(
		branches.flatMap((branch) =>
			branchKind(branch.ref) === "local" && branch.upstream !== null ? [branch.upstream] : [],
		),
	);
	return branches.flatMap((branch) => {
		const kind = branchKind(branch.ref);
		if (kind === "remote" && localUpstreams.has(branch.name)) return [];
		return [{ ...branch, kind }];
	});
}

/** `GitClient` minus what the service does not use; new `GitClient` members join the slice automatically. */
export type GitClientSlice = Omit<GitClient, "path" | "satisfies" | "symbolicRef">;

/**
 * The visible branches' recently checked-out local branch names, in reflog
 * order: the default branch is excluded (it has its own group), names with
 * no matching local branch are dropped (deleted), and the list caps at
 * {@link RECENT_BRANCHES_LIMIT} — GitHub Desktop's `refreshRecentBranches`.
 */
function recentBranchNamesOf(
	branches: ReadonlyArray<IBranch>,
	recentNames: ReadonlyArray<string>,
	defaultBranch: string | undefined,
): string[] {
	const localNames = new Set(
		branches.flatMap((branch) => (branchKind(branch.ref) === "local" ? [branch.name] : [])),
	);

	const recentBranches: string[] = [];
	for (const name of recentNames) {
		// The default branch already has its own section in the branch
		// list so we exclude it here.
		if (name === defaultBranch) {
			continue;
		}

		// This means the recent branch has been deleted. That's fine.
		if (!localNames.has(name)) {
			continue;
		}

		recentBranches.push(name);

		if (recentBranches.length >= RECENT_BRANCHES_LIMIT) {
			break;
		}
	}

	return recentBranches;
}

export interface GitServiceOptions {
	readonly logger: MainSdkLogger;
	/**
	 * Resolves the absolute workspace folder paths git operations are
	 * allowed to run in, or `null` when the workspaces capability is
	 * unavailable. Resolved per call (request-time), so provider boot
	 * order is irrelevant.
	 */
	readonly getWorkspaceFolderPaths: () => Promise<readonly string[] | null>;
	/**
	 * Base directory for generated patch files. Defaults to `os.tmpdir()`
	 * inside git-client; the shell passes the Electron temp directory.
	 */
	readonly tempDir?: string;
	/** Factory for the shared client. Overridable in tests. */
	readonly createClient?: () => GitClientSlice;
}

/**
 * Defense in depth for a renderer-reachable file-read primitive: the contract
 * only validates non-empty strings, so the service itself rejects absolute
 * paths and paths that resolve outside `workingDirectory`. Git would reject
 * escapes too (`OutsideRepository`), but not before an unnecessary spawn —
 * and absolute paths inside the working directory would read fine.
 */
function assertInsideWorkingDirectory(workingDirectory: string, repoRelativePath: string): void {
	const resolvedFrom = relative(workingDirectory, resolve(workingDirectory, repoRelativePath));
	// `startsWith("..")` alone would falsely reject an in-tree file named
	// `..foo` — a legal name on macOS/Linux.
	if (
		isAbsolute(repoRelativePath) ||
		resolvedFrom === ".." ||
		resolvedFrom.startsWith(`..${sep}`)
	) {
		throw new FeatureError(
			`"${repoRelativePath}" is not a path inside the working directory.`,
			"VALIDATION",
		);
	}
}

/** Whether `candidate` is `folder` itself or a path inside it. */
function isSameOrWithin(folder: string, candidate: string): boolean {
	const relativePath = relative(folder, candidate);
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

function createDefaultClient(logger: MainSdkLogger): GitClientSlice {
	// git-client's `GitLogger` is the narrow `{ error }` interface, which
	// `MainSdkLogger` satisfies directly.
	return createGitClient({ logger });
}

/**
 * The one error mapped to a `FeatureError` across every method: no git
 * binary means the message must survive the IPC boundary. Everything else
 * propagates unwrapped (the IPC boundary scrubs generic errors, and
 * git-client logs the detail via the adapted logger).
 */
function gitNotDetectedToFeatureError(error: unknown): unknown {
	if (error instanceof GitNotDetectedError) {
		return new FeatureError(
			"Git executable not found. Install git and make sure it is on your PATH.",
			"BUSINESS",
		);
	}
	return error;
}

/**
 * Expected user-facing checkout failures: git's parsed description (the
 * "already exists" / "local changes overwritten" copy) must survive the IPC
 * boundary, so they map to `FeatureError`s; anything else propagates
 * unwrapped (scrubbed at IPC, logged by git-client).
 */
function checkoutErrorToFeatureError(error: unknown): unknown {
	if (isGitError(error, GitErrorCode.BranchAlreadyExists)) {
		return new FeatureError(error.result.gitErrorDescription ?? error.message, "BUSINESS");
	}
	if (isGitError(error, GitErrorCode.LocalChangesOverwritten)) {
		return new FeatureError(error.result.gitErrorDescription ?? error.message, "BUSINESS");
	}
	return gitNotDetectedToFeatureError(error);
}

function gitActionErrorToFeatureError(error: unknown): unknown {
	if (isGitError(error)) {
		return new FeatureError(error.result.gitErrorDescription ?? error.message, "BUSINESS");
	}
	return gitNotDetectedToFeatureError(error);
}

export function ghErrorToFeatureError(error: unknown): FeatureError {
	const failure = error as Partial<ExecaError>;
	const detail = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
	if ((failure as { code?: string }).code === "ENOENT") {
		return new FeatureError(
			"GitHub CLI (gh) is not installed. Install it from https://cli.github.com/.",
			"BUSINESS",
		);
	}
	if (/auth login|not logged|authentication/i.test(detail)) {
		return new FeatureError(
			"Not authenticated with GitHub CLI. Run 'gh auth login' first.",
			"BUSINESS",
		);
	}
	return new FeatureError(detail || "GitHub CLI operation failed.", "BUSINESS");
}

export function classifyGithubCliError(error: unknown): Exclude<GithubCliStatus, "ready"> {
	const failure = error as Partial<ExecaError> & { code?: string; timedOut?: boolean };
	const detail = typeof failure.stderr === "string" ? failure.stderr : "";
	if (failure.code === "ENOENT") return "missing";
	if (failure.timedOut) return "timeout";
	if (/auth login|not logged|authentication/i.test(detail)) return "unauthenticated";
	return "error";
}

function truncate(text: string, maxChars: number): string {
	return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}

function parseJsonArray(json: string): unknown[] {
	const value = JSON.parse(json) as unknown;
	return Array.isArray(value)
		? value.filter((item) => item !== null && typeof item === "object")
		: [];
}

/** Sum `git diff --numstat` rows; binary rows (`-`) carry no line counts. */
export function parseNumstat(output: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of output.split("\n")) {
		const [added, deleted] = line.split("\t");
		const addedCount = Number.parseInt(added ?? "", 10);
		const deletedCount = Number.parseInt(deleted ?? "", 10);
		if (Number.isNaN(addedCount) || Number.isNaN(deletedCount)) continue;
		additions += addedCount;
		deletions += deletedCount;
	}
	return { additions, deletions };
}

/**
 * Line count of an untracked text file as git numstat would report it; 0
 * for binary (NUL byte) or oversized files and for anything unreadable.
 */
async function countUntrackedLines(filePath: string): Promise<number> {
	let handle;
	try {
		handle = await open(filePath, "r");
		const { size } = await handle.stat();
		if (size === 0 || size > UNTRACKED_STATS_MAX_BYTES) return 0;
		const buffer = Buffer.alloc(size);
		await handle.read(buffer, 0, size, 0);
		if (buffer.includes(0)) return 0;
		let lines = 0;
		for (const byte of buffer) if (byte === 0x0a) lines += 1;
		return buffer[size - 1] === 0x0a ? lines : lines + 1;
	} catch {
		return 0;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

function parsePullRequest(json: string): GitPullRequest {
	try {
		const value = JSON.parse(json) as Record<string, unknown>;
		if (
			typeof value.number !== "number" ||
			typeof value.url !== "string" ||
			typeof value.title !== "string" ||
			typeof value.baseRefName !== "string" ||
			typeof value.headRefName !== "string" ||
			!(["OPEN", "CLOSED", "MERGED"] as const).includes(
				value.state as "OPEN" | "CLOSED" | "MERGED",
			) ||
			typeof value.isDraft !== "boolean"
		) {
			throw new Error("missing fields");
		}
		return {
			number: value.number,
			url: value.url,
			title: value.title,
			baseBranch: value.baseRefName,
			headBranch: value.headRefName,
			state: (value.state as "OPEN" | "CLOSED" | "MERGED").toLowerCase() as GitPullRequest["state"],
			isDraft: value.isDraft,
		};
	} catch {
		throw new FeatureError("GitHub CLI returned invalid pull request data.", "BUSINESS");
	}
}

function commitSha(value: unknown): string | null {
	return typeof value === "string" && COMMIT_SHA_PATTERN.test(value) ? value : null;
}

function parsePullRequestCandidate(item: unknown): PullRequestCandidate {
	const commits = (item ?? {}) as { headRefOid?: unknown; mergeCommit?: { oid?: unknown } | null };
	return {
		pullRequest: parsePullRequest(JSON.stringify(item)),
		headSha: commitSha(commits.headRefOid),
		mergeSha: commitSha(commits.mergeCommit?.oid),
	};
}

function parseJsonValue(json: string): unknown {
	try {
		return JSON.parse(json) as unknown;
	} catch {
		throw new FeatureError("GitHub CLI returned invalid pull request data.", "BUSINESS");
	}
}

/**
 * Git status/branch/worktree service over git-client.
 *
 * Stateless, backed by one shared client: git-client resolves the git binary
 * lazily and memoizes it per instance, so the binary resolution cost is paid
 * once per service, not per call. Every method selects its working directory
 * via the client's `cwd` option.
 *
 * Semantics inherited from git-client and deliberately not deviated from:
 * - `null` from `status`/`branches` means the probe exited 128 — a missing
 *   directory and a non-repo directory are indistinguishable. `branches`
 *   runs its probes (local+remote refs, status for the current branch,
 *   plus the grouping inputs: remote HEAD, `init.defaultBranch` global
 *   config, recent reflog names) in parallel and collapses to `null`
 *   when the refs or status probe reports not-a-repo — the grouping
 *   probes resolve their failure modes as data, so they never turn a
 *   regular repo into `null`. Remote-tracking refs that a local branch
 *   already tracks are omitted so the switcher shows one row per
 *   checkout target, and the result carries the detected `defaultBranch`
 *   (Desktop's `findDefaultBranch` priority, remote always `origin`)
 *   and `recentBranches` (reflog order, local-only, default excluded,
 *   deleted dropped, capped at 5).
 *   `kind: "remote"` checkout uses `git checkout --track`.
 * - `repositoryType` is the explicit replacement for that accidental
 *   guardrail: one `git rev-parse` probe classifies the directory as
 *   `missing`/`unsafe`/`bare`/`regular` (ported from GitHub Desktop), and
 *   the renderer gates the branch selector on `kind === "regular"` before
 *   the data probes ever run. It never resolves `null` — `missing` is an
 *   explicit kind, and `unsafe` crosses the contract so a trust flow can
 *   be added later without schema changes.
 * - `GitNotDetectedError` (no git binary on PATH) is mapped to a
 *   `FeatureError` on every method so its message survives the IPC boundary;
 *   every other unexpected error propagates unwrapped (the IPC boundary
 *   scrubs generic errors, and git-client logs the detail via the adapted
 *   logger). The worktree delegate methods additionally map `GitError`s to
 *   `FeatureError`s carrying git's parsed descriptions, because their
 *   failures (missing base branch, locked worktree, …) are user-facing copy.
 * - `checkout` additionally maps the two expected user-facing failures
 *   (`BranchAlreadyExists`, `LocalChangesOverwritten`) to `FeatureError`s
 *   carrying git's parsed descriptions, so the UI can surface them. With
 *   `create`, the new branch is based on `startPoint` when given — the
 *   default branch while branching off it, per Desktop's dialog — and on
 *   the current HEAD when omitted.
 * - `init` turns a plain workspace folder into an unborn repository with
 *   one `git -c init.defaultBranch=<branch> init` (the global config value
 *   falling back to `main`, passed via `-c` and never written to config,
 *   no initial commit). Idempotent: on an existing repository it
 *   reinitializes harmlessly and leaves HEAD untouched.
 *
 * Workspace containment: every directory-taking call (`status`,
 * `branches`, `repositoryType`, `checkout`, `init`, `createPatch`,
 * `getDiffContents`, `hasWorktreeWork`, `defaultBranch`) resolves the
 * workspace folders per request and rejects with a `VALIDATION` FeatureError
 * unless the directory equals or is inside one of them — this choke point
 * covers both the IPC channels and the `kilo-git://` protocol handler in one
 * place. The capability is resolved per call, so boot order never matters,
 * and an absent capability fails closed (kilo-ui is bundled and always
 * booted by the time renderer requests exist). Legitimate renderer traffic
 * always passes workspace folder paths, so the guard never trips in normal
 * use.
 *
 * Repository actions and GitHub state are the service's only mutable
 * state, all process-local caches: the `gh auth status` probe (5 min on
 * success, 30 s on failure, concurrent probes coalesced), `gh repo view`
 * identity per directory (bounded LRU, failures cached briefly), and
 * per-directory fetch coalescing/throttling.
 * `gh` is only spawned for directories whose origin is a GitHub remote.
 *
 * `available` is a probe, so its error semantics differ from `status` on
 * purpose: every failure collapses to `false` — including
 * `GitNotDetectedError`, which `version()` can throw synchronously because
 * binary resolution runs before the memoized promise exists, hence
 * `try { await }` rather than a `.catch()` — and `false` is an expected
 * outcome, not an error, so nothing is logged. `version()` memoizes its
 * promise per client (rejections included) and the service shares one
 * client, so the probe result is effectively cached for the app's lifetime.
 */
export class GitService {
	readonly #client: GitClientSlice;
	readonly #getWorkspaceFolderPaths: () => Promise<readonly string[] | null>;
	readonly #tempDir: string | undefined;
	/**
	 * Patch file paths handed to callers but not yet released. The protocol
	 * handler owns a patch's lifetime (release on stream close/cancel);
	 * this set is only the dispose-time sweep of anything still in flight
	 * when the plugin tears down — orphaned files after a hard quit are
	 * OS-reaped (the OS temp directory).
	 */
	readonly #inFlightPatchPaths = new Set<string>();
	readonly #worktrees: WorktreeManager;
	#githubCliProbe: { status: GithubCliStatus; expiresAt: number } | null = null;
	#githubCliProbePromise: Promise<{ status: GithubCliStatus }> | null = null;
	readonly #repositoryIdentity = new Map<
		string,
		{ repository: string | null; parentRepository: string | null; expiresAt: number }
	>();
	readonly #fetches = new Map<string, { promise: Promise<void> | null; settledAt: number }>();

	constructor(options: GitServiceOptions) {
		this.#client = options.createClient?.() ?? createDefaultClient(options.logger);
		this.#getWorkspaceFolderPaths = options.getWorkspaceFolderPaths;
		this.#tempDir = options.tempDir;
		this.#worktrees = new WorktreeManager({
			client: this.#client,
			logger: options.logger,
			resolveDefaultBranch: (wd) => this.defaultBranch(wd),
		});
	}

	/**
	 * Resolve the allowed workspace folders and reject `directory` unless
	 * it equals or is inside one of them. `null` (capability absent) is a
	 * rejection too — containment fails closed.
	 */
	async #assertWithinWorkspaceFolders(directory: string): Promise<void> {
		const folderPaths = await this.#getWorkspaceFolderPaths();
		if (folderPaths === null) {
			throw new FeatureError(
				"Workspaces are unavailable, so the directory cannot be verified as part of a workspace.",
				"VALIDATION",
			);
		}
		if (!folderPaths.some((folderPath) => isSameOrWithin(folderPath, directory))) {
			throw new FeatureError(`"${directory}" is not inside a workspace folder.`, "VALIDATION");
		}
	}

	async status(workingDirectory: string): Promise<GitStatus | null> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			const result = await this.#client.status({ cwd: workingDirectory });
			if (result === null) {
				return null;
			}
			// `WorkingDirectoryStatus.files` is `ReadonlyArray` in git-client
			// while the contract's input type is a mutable array — a shallow
			// spread is the only mapping needed.
			return {
				...result,
				workingDirectory: { files: [...result.workingDirectory.files] },
			};
		} catch (error) {
			throw gitNotDetectedToFeatureError(error);
		}
	}

	/**
	 * Commit exactly what is staged. The staging happens in
	 * {@link stageChanges}, so the generated message describes the same
	 * index that gets committed even if files keep changing meanwhile.
	 */
	async commit(workingDirectory: string, message: string): Promise<void> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			await this.#client.exec(["commit", "-m", message], "commit", { cwd: workingDirectory });
		} catch (error) {
			throw gitActionErrorToFeatureError(error);
		}
	}

	/**
	 * Stage every working-tree change, then describe the index (not the
	 * working tree) for commit-message generation.
	 */
	async stageChanges(workingDirectory: string): Promise<{
		statusSummary: string;
		diffPatch: string;
		recentCommitSubjects: string[];
	}> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			await this.#client.exec(["add", "--all", "--"], "add", { cwd: workingDirectory });
			const [statusSummary, diffPatch, recentCommitSubjects] = await Promise.all([
				this.#boundedOutput(
					["status", "--short"],
					"status short",
					workingDirectory,
					SUMMARY_MAX_CHARS,
				),
				this.#boundedOutput(
					["diff", "--cached", "--no-ext-diff", "--no-color", "-M"],
					"staged diff",
					workingDirectory,
					PATCH_MAX_CHARS,
				),
				this.#recentCommitSubjects(workingDirectory),
			]);
			return { statusSummary, diffPatch, recentCommitSubjects };
		} catch (error) {
			throw gitActionErrorToFeatureError(error);
		}
	}

	/**
	 * `git fetch --prune`, coalesced per directory and throttled to one run
	 * per {@link FETCH_THROTTLE_MS}: every chat header and menu open asks for
	 * a fetch, and concurrent fetches contend for the same ref locks.
	 */
	async fetch(workingDirectory: string): Promise<void> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		const entry = this.#fetches.get(workingDirectory);
		if (entry?.promise) return entry.promise;
		if (entry && Date.now() - entry.settledAt < FETCH_THROTTLE_MS) return;
		const promise = this.#client
			.exec(["fetch", "--prune"], "fetch", { cwd: workingDirectory })
			.then(
				() => undefined,
				(error: unknown) => {
					throw gitActionErrorToFeatureError(error);
				},
			)
			.finally(() => {
				this.#fetches.set(workingDirectory, { promise: null, settledAt: Date.now() });
			});
		this.#fetches.set(workingDirectory, { promise, settledAt: entry?.settledAt ?? 0 });
		return promise;
	}

	async push(workingDirectory: string, branch: string, hasUpstream: boolean): Promise<void> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		if (branch.startsWith("-")) {
			throw new FeatureError(`"${branch}" is not a valid branch name.`, "VALIDATION");
		}
		try {
			const args = hasUpstream ? ["push"] : ["push", "--set-upstream", DEFAULT_REMOTE_NAME, branch];
			await this.#client.exec(args, "push", { cwd: workingDirectory });
		} catch (error) {
			throw gitActionErrorToFeatureError(error);
		}
	}

	async pull(workingDirectory: string): Promise<void> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			await this.#client.exec(["pull", "--ff-only"], "pull", { cwd: workingDirectory });
		} catch (error) {
			throw gitActionErrorToFeatureError(error);
		}
	}

	async originUrl(workingDirectory: string): Promise<string | null> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			return await this.#readOriginUrl(workingDirectory);
		} catch (error) {
			throw gitActionErrorToFeatureError(error);
		}
	}

	async #readOriginUrl(workingDirectory: string): Promise<string | null> {
		const result = await this.#client.exec(
			["remote", "get-url", DEFAULT_REMOTE_NAME],
			"remote get-url",
			{ cwd: workingDirectory, successExitCodes: new Set([0, 2]) },
		);
		return result.exitCode === 0 ? result.stdout.trim() || null : null;
	}

	async githubCliStatus(force = false): Promise<{ status: GithubCliStatus }> {
		if (!force && this.#githubCliProbe && this.#githubCliProbe.expiresAt > Date.now()) {
			return { status: this.#githubCliProbe.status };
		}
		if (!force && this.#githubCliProbePromise) return this.#githubCliProbePromise;
		const probe = (async () => {
			let status: GithubCliStatus;
			try {
				const result = await execa("gh", ["auth", "status"], {
					reject: false,
					timeout: GH_TIMEOUT_MS,
					windowsHide: true,
				});
				status =
					result.exitCode === 0 ? "ready" : classifyGithubCliError({ stderr: result.stderr });
			} catch (error) {
				status = classifyGithubCliError(error);
			}
			this.#githubCliProbe = {
				status,
				expiresAt:
					Date.now() + (status === "ready" ? GH_PROBE_SUCCESS_TTL_MS : GH_PROBE_FAILURE_TTL_MS),
			};
			return { status };
		})();
		this.#githubCliProbePromise = probe;
		try {
			return await probe;
		} finally {
			if (this.#githubCliProbePromise === probe) this.#githubCliProbePromise = null;
		}
	}

	async pullRequest(workingDirectory: string): Promise<GitPullRequest | null> {
		return (await this.pullRequestSnapshot(workingDirectory)).pullRequest;
	}

	/**
	 * The pull request for the directory's current branch. Local probes run
	 * first and short-circuit before any `gh` spawn: no branch or a
	 * non-GitHub origin resolves `githubStatus: "unsupported"`, and an
	 * unavailable GitHub CLI resolves its capability status instead of
	 * throwing, so background polling never surfaces an error for
	 * repositories the CLI cannot serve. An open match wins; otherwise the
	 * newest closed or merged match in this checkout's history, never on the
	 * default branch.
	 */
	async pullRequestSnapshot(workingDirectory: string): Promise<GitPullRequestSnapshot> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			const plan = await this.#planPullRequestLookup(workingDirectory);
			if (plan.kind === "resolved") return plan.snapshot;
			const candidates = await this.#findPullRequests(
				workingDirectory,
				plan.branch,
				plan.upstream,
				plan.sha,
				plan.owner,
			);
			return await this.#snapshotFromCandidates(plan, candidates);
		} catch (error) {
			if (error instanceof FeatureError) throw error;
			throw ghErrorToFeatureError(error);
		}
	}

	/**
	 * `pullRequestSnapshot` for many directories with one `gh api graphql`
	 * request per chunk of same-repository checkouts instead of up to four `gh`
	 * processes each (the VS Code Agent Manager's batched full sync). The
	 * batch answers only what the per-directory ladder would answer the same
	 * way; every other directory (outside the workspace, a failed probe or
	 * request, a fork or `refs/pull` tracking branch that `gh pr view`
	 * resolves through branch config) comes back `null`, and the caller looks
	 * it up individually. A failed batch is therefore never worse than no batch.
	 */
	async pullRequestSnapshots(
		workingDirectories: readonly string[],
	): Promise<{ workingDirectory: string; snapshot: GitPullRequestSnapshot | null }[]> {
		const limit = pLimit(BATCH_PLAN_CONCURRENCY);
		const plans = await Promise.all(
			workingDirectories.map((workingDirectory) =>
				limit(async () => {
					try {
						await this.#assertWithinWorkspaceFolders(workingDirectory);
						return await this.#planPullRequestLookup(workingDirectory, { batch: true });
					} catch {
						return null;
					}
				}),
			),
		);
		const answers = new Map<string, GitPullRequestSnapshot>();
		const pending = new Map<string, PullRequestLookupPlan[]>();
		for (const plan of plans) {
			if (!plan) continue;
			if (plan.kind === "resolved") {
				answers.set(plan.workingDirectory, plan.snapshot);
			} else if (plan.batch) {
				const key = `${plan.batch.host}/${plan.snapshot.repository}`;
				pending.set(key, [...(pending.get(key) ?? []), plan]);
			}
		}
		for (const group of pending.values()) {
			for (let start = 0; start < group.length; start += BATCH_CHUNK_SIZE) {
				await this.#answerBatch(group.slice(start, start + BATCH_CHUNK_SIZE), answers);
			}
		}
		return workingDirectories.map((workingDirectory) => ({
			workingDirectory,
			snapshot: answers.get(workingDirectory) ?? null,
		}));
	}

	async #answerBatch(
		plans: readonly PullRequestLookupPlan[],
		answers: Map<string, GitPullRequestSnapshot>,
	): Promise<void> {
		const first = plans[0]!;
		const [owner, name] = first.snapshot.repository!.split("/") as [string, string];
		const result = await this.#gh(
			first.workingDirectory,
			batchQueryArgs(
				first.batch!.host,
				{ owner, name },
				plans.map((plan) => ({
					branch: plan.branch,
					upstreamBranch: plan.batch!.upstreamBranch,
					sha: plan.sha,
				})),
			),
		);
		// `gh api graphql` exits nonzero on partial errors but still prints the data.
		const nodes = parseBatchResponse(result.stdout ?? "", plans.length);
		await Promise.all(
			plans.map(async (plan, index) => {
				const answered = nodes[index];
				if (!answered) return;
				try {
					const snapshot = await this.#snapshotFromBatch(plan, answered);
					if (snapshot) answers.set(plan.workingDirectory, snapshot);
				} catch {
					// Left for the per-directory lookup.
				}
			}),
		);
	}

	async #snapshotFromBatch(
		plan: PullRequestLookupPlan,
		nodes: BatchNodes,
	): Promise<GitPullRequestSnapshot | null> {
		const named = finderPick(nodes.byBranch) ?? finderPick(nodes.byUpstream);
		if (named) return this.#snapshotFromCandidates(plan, [parsePullRequestCandidate(named)]);
		const atHead = nodes.byHead.find(
			(node) =>
				node.state === "OPEN" &&
				node.headRefOid === plan.sha &&
				isOwnHead(node.headRefName, plan.branch, plan.upstream),
		);
		if (atHead) return this.#snapshotFromCandidates(plan, [parsePullRequestCandidate(atHead)]);
		if (await this.#resolvesThroughBranchConfig(plan.workingDirectory, plan.branch)) return null;
		return { ...plan.snapshot, pullRequest: null };
	}

	/**
	 * Whether `gh pr view` would look the branch up somewhere a name lookup in
	 * this repository cannot: a `refs/pull/N/head` tracking ref (`gh pr
	 * checkout`), or a push remote other than origin (a fork's head).
	 */
	async #resolvesThroughBranchConfig(workingDirectory: string, branch: string): Promise<boolean> {
		const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const result = await this.#client.exec(
			[
				"config",
				"-z",
				"--get-regexp",
				`^(branch\\.${escaped}\\.(merge|pushremote)|remote\\.pushdefault)$`,
			],
			"pull request branch config",
			{ cwd: workingDirectory, successExitCodes: new Set([0, 1]) },
		);
		return result.stdout
			.split("\0")
			.filter(Boolean)
			.some((entry) => {
				const [key = "", value = ""] = entry.split("\n");
				return key.endsWith(".merge")
					? value.startsWith("refs/pull/")
					: value !== DEFAULT_REMOTE_NAME;
			});
	}

	/**
	 * Local and cached facts every pull request lookup needs, resolving the
	 * snapshot outright when no lookup could find anything: no branch or a
	 * non-GitHub origin (`unsupported`), an unusable GitHub CLI (its status),
	 * or an unborn branch. `batch` also derives what the batched query needs,
	 * leaving it unset for checkouts only the per-directory ladder can serve.
	 *
	 * Background polling plans every chat worktree, so the branch comes from
	 * refs (`headBranch`), never a working-tree `status` scan.
	 */
	async #planPullRequestLookup(
		workingDirectory: string,
		options: { batch?: boolean } = {},
	): Promise<PullRequestLookupPlan | ResolvedPullRequestLookup> {
		const headBranch = await this.#client
			.headBranch({ cwd: workingDirectory })
			.catch((error: unknown) => {
				throw gitNotDetectedToFeatureError(error);
			});
		const branch = headBranch?.name ?? null;
		const resolved = (githubStatus: GithubSnapshotStatus) => ({
			kind: "resolved" as const,
			workingDirectory,
			snapshot: {
				identity: null,
				branch,
				repository: null,
				parentRepository: null,
				pullRequest: null,
				githubStatus,
			},
		});
		if (!branch) return resolved("unsupported");
		const origin = await this.#readOriginUrl(workingDirectory);
		const repositoryUrl = origin ? githubRepositoryUrl(origin) : null;
		if (!repositoryUrl) return resolved("unsupported");
		const capability = await this.githubCliStatus();
		if (capability.status !== "ready") return resolved(capability.status);
		const head = await this.#client.exec(
			["rev-parse", "--verify", "--quiet", "HEAD"],
			"head identity",
			{ cwd: workingDirectory, successExitCodes: new Set([0, 1]) },
		);
		const sha = head.exitCode === 0 ? head.stdout.trim() : "";
		// An unborn branch has nothing a pull request could contain.
		if (!sha) return resolved("ready");
		const upstream = headBranch?.upstream ?? undefined;
		const repositoryIdentity = await this.#githubRepositoryIdentity(workingDirectory);
		const originUpstream = upstream?.startsWith(`${DEFAULT_REMOTE_NAME}/`)
			? upstream.slice(DEFAULT_REMOTE_NAME.length + 1)
			: undefined;
		const batchable =
			options.batch &&
			repositoryIdentity.repository !== null &&
			COMMIT_SHA_PATTERN.test(sha) &&
			(upstream === undefined || originUpstream !== undefined);
		return {
			kind: "lookup",
			workingDirectory,
			branch,
			upstream,
			sha,
			owner: repositoryIdentity.repository?.split("/")[0] ?? null,
			snapshot: {
				identity: `${upstream ?? branch}|${sha}`,
				branch,
				...repositoryIdentity,
				githubStatus: "ready",
			},
			batch: batchable
				? {
						host: new URL(repositoryUrl).hostname,
						upstreamBranch: originUpstream && originUpstream !== branch ? originUpstream : null,
					}
				: null,
		};
	}

	/**
	 * An open match wins; otherwise the newest closed or merged match in this
	 * checkout's history, never on the default branch.
	 */
	async #snapshotFromCandidates(
		plan: PullRequestLookupPlan,
		candidates: readonly PullRequestCandidate[],
	): Promise<GitPullRequestSnapshot> {
		const open = candidates.find((candidate) => candidate.pullRequest.state === "open");
		if (open) return { ...plan.snapshot, pullRequest: open.pullRequest };
		if (candidates.length === 0) return { ...plan.snapshot, pullRequest: null };
		if (plan.branch === (await this.defaultBranch(plan.workingDirectory))) {
			return { ...plan.snapshot, pullRequest: null };
		}
		for (const candidate of candidates) {
			if (await this.#isInCheckoutHistory(plan.workingDirectory, candidate)) {
				return { ...plan.snapshot, pullRequest: candidate.pullRequest };
			}
		}
		return { ...plan.snapshot, pullRequest: null };
	}

	/**
	 * Candidate pull requests for `branch`, most specific lookup first:
	 * `gh pr view` (branch config aware), an open PR whose head is exactly
	 * HEAD, then every PR with that head branch name. `gh pr list --head`
	 * rejects `owner:branch`, so the owner match is filtered client-side.
	 *
	 * The SHA match must also be headed by `branch` or its upstream: a new
	 * branch (e.g. a fresh worktree) starts at its base's tip and so shares
	 * HEAD with the base branch's PR, open or merged, without belonging to it.
	 */
	async #findPullRequests(
		workingDirectory: string,
		branch: string,
		upstream: string | undefined,
		sha: string,
		owner: string | null,
	): Promise<PullRequestCandidate[]> {
		for (const args of [
			["pr", "view", branch, "--json", PULL_REQUEST_LOOKUP_FIELDS],
			["pr", "view", "--json", PULL_REQUEST_LOOKUP_FIELDS],
		]) {
			const result = await this.#gh(workingDirectory, args);
			if (result.exitCode === 0) return [parsePullRequestCandidate(parseJsonValue(result.stdout))];
		}
		const bySha = await this.#gh(workingDirectory, [
			"pr",
			"list",
			"--state",
			"open",
			"--search",
			`${sha} is:pr`,
			"--limit",
			"5",
			"--json",
			PULL_REQUEST_LOOKUP_FIELDS,
		]);
		if (bySha.exitCode === 0) {
			const match = parseJsonArray(bySha.stdout).find((item) => {
				const head = item as { headRefOid?: unknown; headRefName?: unknown };
				return head.headRefOid === sha && isOwnHead(head.headRefName, branch, upstream);
			});
			if (match) return [parsePullRequestCandidate(match)];
		}
		const byBranch = await this.#gh(workingDirectory, [
			"pr",
			"list",
			"--head",
			branch,
			"--state",
			"all",
			"--limit",
			"20",
			"--json",
			`${PULL_REQUEST_LOOKUP_FIELDS},headRepositoryOwner`,
		]);
		if (byBranch.exitCode !== 0) {
			throw Object.assign(new Error(byBranch.stderr), { stderr: byBranch.stderr });
		}
		return parseJsonArray(byBranch.stdout)
			.filter((item) => {
				if (!owner) return true;
				const login = (item as { headRepositoryOwner?: { login?: unknown } | null })
					.headRepositoryOwner?.login;
				return typeof login === "string" && login.toLowerCase() === owner.toLowerCase();
			})
			.map(parsePullRequestCandidate);
	}

	/**
	 * Whether a closed or merged pull request belongs to this checkout.
	 * Branch-name lookups return every pull request ever headed by the name,
	 * so a branch recreated under an old name would inherit its merged PR.
	 * The PR is this checkout's when HEAD contains its head, or trails it
	 * (commits added on GitHub, e.g. accepted suggestions, never pulled), and
	 * HEAD does not also contain its merge commit: a branch cut from the base
	 * after the merge contains both. A commit git cannot resolve is absent
	 * locally, so it is not in HEAD's history either.
	 */
	async #isInCheckoutHistory(
		workingDirectory: string,
		{ pullRequest, headSha, mergeSha }: PullRequestCandidate,
	): Promise<boolean> {
		if (pullRequest.state === "open" || !headSha) return true;
		const related =
			(await this.#isAncestor(workingDirectory, headSha, "HEAD")) ||
			(await this.#isAncestor(workingDirectory, "HEAD", headSha));
		if (!related) return false;
		return mergeSha === null || !(await this.#isAncestor(workingDirectory, mergeSha, "HEAD"));
	}

	async #isAncestor(workingDirectory: string, ancestor: string, descendant: string) {
		const result = await this.#client.exec(
			["merge-base", "--is-ancestor", ancestor, descendant],
			"pull request ancestry",
			{ cwd: workingDirectory, successExitCodes: new Set([0, 1, 128]) },
		);
		return result.exitCode === 0;
	}

	#gh(workingDirectory: string, args: string[]) {
		return execa("gh", args, {
			cwd: workingDirectory,
			reject: false,
			timeout: GH_TIMEOUT_MS,
			windowsHide: true,
		});
	}

	async #githubRepositoryIdentity(
		workingDirectory: string,
	): Promise<{ repository: string | null; parentRepository: string | null }> {
		const cached = this.#repositoryIdentity.get(workingDirectory);
		if (cached && cached.expiresAt > Date.now()) {
			return { repository: cached.repository, parentRepository: cached.parentRepository };
		}
		const result = await this.#gh(workingDirectory, [
			"repo",
			"view",
			"--json",
			"nameWithOwner,parent",
		]);
		let repository: string | null = null;
		let parentRepository: string | null = null;
		if (result.exitCode === 0) {
			try {
				const value = JSON.parse(result.stdout) as {
					nameWithOwner?: unknown;
					parent?: { nameWithOwner?: unknown } | null;
				};
				repository = typeof value.nameWithOwner === "string" ? value.nameWithOwner : null;
				parentRepository =
					typeof value.parent?.nameWithOwner === "string" ? value.parent.nameWithOwner : null;
			} catch {
				// Unparseable output is treated like a failed lookup.
			}
		}
		this.#repositoryIdentity.delete(workingDirectory);
		if (this.#repositoryIdentity.size >= REPOSITORY_IDENTITY_CACHE_LIMIT) {
			const oldest = this.#repositoryIdentity.keys().next().value;
			if (oldest !== undefined) this.#repositoryIdentity.delete(oldest);
		}
		this.#repositoryIdentity.set(workingDirectory, {
			repository,
			parentRepository,
			expiresAt:
				Date.now() + (repository ? REPOSITORY_IDENTITY_TTL_MS : REPOSITORY_IDENTITY_FAILURE_TTL_MS),
		});
		return { repository, parentRepository };
	}

	async createPullRequest(input: {
		workingDirectory: string;
		baseBranch: string;
		headBranch: string;
		title: string;
		body: string;
	}): Promise<GitPullRequest> {
		await this.#assertWithinWorkspaceFolders(input.workingDirectory);
		const bodyFile = path.join(tmpdir(), `kilo-desktop-pr-${randomUUID()}.md`);
		try {
			const identity = await this.#githubRepositoryIdentity(input.workingDirectory);
			// From a fork, gh needs `owner:branch` to find the pushed head.
			const forkOwner = identity.parentRepository ? identity.repository?.split("/")[0] : undefined;
			await writeFile(bodyFile, input.body, { encoding: "utf8", mode: 0o600 });
			const created = await execa(
				"gh",
				[
					"pr",
					"create",
					"--draft",
					"--base",
					input.baseBranch,
					"--head",
					forkOwner ? `${forkOwner}:${input.headBranch}` : input.headBranch,
					"--title",
					input.title,
					"--body-file",
					bodyFile,
				],
				{ cwd: input.workingDirectory, timeout: GH_TIMEOUT_MS, windowsHide: true },
			);
			const url = String(created.stdout)
				.split(/\s+/)
				.find((token) => /^https?:\/\/\S+\/pull\/\d+$/.test(token));
			if (url) {
				const view = await this.#gh(input.workingDirectory, [
					"pr",
					"view",
					url,
					"--json",
					PULL_REQUEST_FIELDS,
				]);
				if (view.exitCode === 0) return parsePullRequest(view.stdout);
			}
			const found = await this.pullRequest(input.workingDirectory);
			if (!found)
				throw new FeatureError("GitHub did not return the created pull request.", "BUSINESS");
			return found;
		} catch (error) {
			if (error instanceof FeatureError) throw error;
			throw ghErrorToFeatureError(error);
		} finally {
			await rm(bodyFile, { force: true });
		}
	}

	/**
	 * Bounded Git context for PR text generation. The range starts from
	 * `origin/<baseBranch>` when that remote-tracking ref exists — a stale
	 * or missing local base branch would otherwise pull already-merged
	 * commits into the description, or fail outright. Every output is
	 * truncated rather than failing when it exceeds its budget.
	 */
	async pullRequestContext(
		workingDirectory: string,
		baseBranch: string,
	): Promise<{
		commitSummary: string;
		diffSummary: string;
		diffPatch: string;
		recentCommitSubjects: string[];
		pullRequestTemplate: string | null;
	}> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		if (baseBranch.startsWith("-")) {
			throw new FeatureError(`"${baseBranch}" is not a valid base branch.`, "VALIDATION");
		}
		try {
			const baseRef = await this.#resolveBaseRef(workingDirectory, baseBranch);
			const range = `${baseRef}...HEAD`;
			const [commitSummary, diffSummary, diffPatch, recentCommitSubjects, pullRequestTemplate] =
				await Promise.all([
					this.#boundedOutput(
						["log", "--format=%h %s", range],
						"log",
						workingDirectory,
						SUMMARY_MAX_CHARS,
					),
					this.#boundedOutput(
						["diff", "--stat", "--no-color", range],
						"diff stat",
						workingDirectory,
						SUMMARY_MAX_CHARS,
					),
					this.#boundedOutput(
						["diff", "--no-ext-diff", "--no-color", "-M", range],
						"diff",
						workingDirectory,
						PATCH_MAX_CHARS,
					),
					this.#recentCommitSubjects(workingDirectory),
					this.#pullRequestTemplate(workingDirectory, baseRef),
				]);
			return { commitSummary, diffSummary, diffPatch, recentCommitSubjects, pullRequestTemplate };
		} catch (error) {
			throw gitActionErrorToFeatureError(error);
		}
	}

	async #resolveBaseRef(workingDirectory: string, baseBranch: string): Promise<string> {
		const remoteRef = `${REMOTE_REF_PREFIX}${DEFAULT_REMOTE_NAME}/${baseBranch}`;
		const probe = await this.#client.exec(
			["rev-parse", "--verify", "--quiet", `${remoteRef}^{commit}`],
			"resolve base ref",
			{ cwd: workingDirectory, successExitCodes: new Set([0, 1]) },
		);
		return probe.exitCode === 0 ? remoteRef : baseBranch;
	}

	/**
	 * Changed-line totals against HEAD (the empty tree when unborn):
	 * `--numstat` for tracked files plus a line count of untracked text
	 * files, capped in count and size so a huge untracked tree stays cheap.
	 * Binary files contribute no lines, matching git's numstat.
	 */
	async workingTreeStats(
		workingDirectory: string,
	): Promise<{ additions: number; deletions: number }> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			const head = await this.#client.exec(
				["rev-parse", "--verify", "--quiet", "HEAD"],
				"head commit",
				{ cwd: workingDirectory, successExitCodes: new Set([0, 1]) },
			);
			const base =
				head.exitCode === 0
					? head.stdout.trim()
					: (
							await this.#client.exec(["hash-object", "-t", "tree", "--stdin"], "empty tree", {
								cwd: workingDirectory,
								stdin: "",
							})
						).stdout.trim();
			const [tracked, untracked] = await Promise.all([
				this.#client.exec(
					["diff", "--numstat", "--no-renames", "--no-color", base, "--"],
					"numstat",
					{
						cwd: workingDirectory,
					},
				),
				this.#client.exec(["ls-files", "--others", "--exclude-standard", "-z"], "untracked files", {
					cwd: workingDirectory,
				}),
			]);
			const totals = parseNumstat(tracked.stdout);
			const untrackedPaths = untracked.stdout
				.split("\0")
				.filter(Boolean)
				.slice(0, UNTRACKED_STATS_MAX_FILES);
			for (const relativePath of untrackedPaths) {
				totals.additions += await countUntrackedLines(path.join(workingDirectory, relativePath));
			}
			return totals;
		} catch (error) {
			throw gitActionErrorToFeatureError(error);
		}
	}

	/** Command output truncated to `maxChars` instead of failing on overflow. */
	async #boundedOutput(
		args: string[],
		name: string,
		workingDirectory: string,
		maxChars: number,
	): Promise<string> {
		try {
			const result = await this.#client.exec(args, name, {
				cwd: workingDirectory,
				// UTF-8 is at most 4 bytes per character.
				maxBuffer: maxChars * 4,
			});
			return truncate(result.stdout, maxChars);
		} catch (error) {
			if (isMaxBufferExceededError(error)) return truncate(String(error.stdout), maxChars);
			throw error;
		}
	}

	async #recentCommitSubjects(workingDirectory: string): Promise<string[]> {
		try {
			const result = await this.#client.exec(
				["log", "-n", "20", "--no-merges", "--pretty=format:%s"],
				"recent commit subjects",
				{ cwd: workingDirectory },
			);
			return result.stdout
				.split("\n")
				.map((subject) => subject.trim())
				.filter(Boolean);
		} catch {
			return [];
		}
	}

	async #pullRequestTemplate(workingDirectory: string, baseRef: string): Promise<string | null> {
		try {
			const treePaths = [...PULL_REQUEST_TEMPLATE_PATHS, ...PULL_REQUEST_TEMPLATE_DIRECTORIES];
			const listing = await this.#boundedOutput(
				["ls-tree", "-r", "-z", "--full-tree", baseRef, "--", ...treePaths],
				"list pull request templates",
				workingDirectory,
				100_000,
			);
			const entries = listing.split("\0").flatMap((record) => {
				const match = record.match(/^100(?:644|755) blob ([0-9a-f]{40,64})\t(.+)$/);
				return match?.[1] && match[2] ? [{ objectId: match[1], path: match[2] }] : [];
			});
			const byPath = new Map(entries.map((entry) => [entry.path, entry]));
			for (const templatePath of PULL_REQUEST_TEMPLATE_PATHS) {
				const entry = byPath.get(templatePath);
				if (!entry) continue;
				const template = await this.#readTemplateBlob(workingDirectory, entry.objectId);
				if (template) return template;
			}
			for (const directory of PULL_REQUEST_TEMPLATE_DIRECTORIES) {
				const prefix = `${directory}/`;
				const candidates = entries.filter((entry) => {
					if (!entry.path.startsWith(prefix)) return false;
					const relativePath = entry.path.slice(prefix.length);
					return !relativePath.includes("/") && relativePath.toLowerCase().endsWith(".md");
				});
				const templates = (
					await Promise.all(
						candidates.map((entry) => this.#readTemplateBlob(workingDirectory, entry.objectId)),
					)
				).filter((template): template is string => template !== null);
				if (templates.length === 1) return templates[0]!;
				if (templates.length > 1) return null;
			}
			return null;
		} catch {
			return null;
		}
	}

	async #readTemplateBlob(workingDirectory: string, objectId: string): Promise<string | null> {
		const template = (
			await this.#boundedOutput(
				["cat-file", "blob", objectId],
				"read PR template",
				workingDirectory,
				PULL_REQUEST_TEMPLATE_MAX_CHARS,
			)
		).trim();
		return template || null;
	}

	async branches(workingDirectory: string): Promise<GitBranchesResult | null> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			// Independent probes, spawned in parallel rather than serially:
			// branch refs, status for the current branch (`for-each-ref`
			// alone cannot report it), and the Desktop-parity grouping
			// inputs (remote HEAD, configured default, recent reflog
			// names). The grouping probes are failure-tolerant by design —
			// symref 128 → null, config 1 → null, reflog 128 → [] — so
			// only branches/status keep the null-means-not-a-repo gate.
			// The recent fetch asks for one more than the limit because
			// the default branch often appears in the reflog and is
			// filtered out afterwards.
			const [branches, status, remoteHead, configuredDefault, recentNames] = await Promise.all([
				this.#client.branches({ cwd: workingDirectory, prefixes: BRANCH_REF_PREFIXES }),
				this.#client.status({ cwd: workingDirectory }),
				this.#client.remoteHead(DEFAULT_REMOTE_NAME, { cwd: workingDirectory }),
				this.#client.globalConfigValue(DEFAULT_BRANCH_CONFIG_KEY),
				this.#client.recentBranches(RECENT_BRANCHES_LIMIT + 1, { cwd: workingDirectory }),
			]);
			if (branches === null || status === null) return null;
			const visible = visibleBranches(branches);
			const defaultBranch = findDefaultBranch(visible, remoteHead, configuredDefault);
			return {
				// Absent on detached HEAD and unborn repositories — matches the
				// schema's optional `currentBranch`.
				...(status.currentBranch === undefined ? {} : { currentBranch: status.currentBranch }),
				branches: visible,
				// Absent when no branch matches the detected default name.
				...(defaultBranch === undefined ? {} : { defaultBranch }),
				recentBranches: recentBranchNamesOf(branches, recentNames, defaultBranch),
			};
		} catch (error) {
			throw gitNotDetectedToFeatureError(error);
		}
	}

	/**
	 * The explicit repository-type probe the selector gate runs on: a
	 * single `git rev-parse` decides `missing`/`unsafe`/`bare`/`regular`,
	 * so non-regular workspaces never spawn the failing data probes.
	 */
	async repositoryType(workingDirectory: string): Promise<GitRepositoryType> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			const result: RepositoryType = await this.#client.repositoryType(workingDirectory);
			// The discriminated unions of git-client's `RepositoryType` and
			// the contract's `GitRepositoryType` align member-for-member;
			// `tsc` enforces the alignment at this assignment.
			return result;
		} catch (error) {
			throw gitNotDetectedToFeatureError(error);
		}
	}

	/**
	 * Check out a branch. `kind: "remote"` creates a local branch that
	 * tracks the named remote-tracking ref. With `create`, first create the
	 * branch off `startPoint` — or the current HEAD when omitted (Desktop's
	 * create-then-checkout flow, where `startPoint: null` means HEAD).
	 */
	async checkout(
		workingDirectory: string,
		branch: string,
		create?: boolean,
		startPoint?: string,
		kind?: GitBranch["kind"],
	): Promise<void> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			if (create) {
				await this.#client.createBranch(branch, startPoint, { cwd: workingDirectory });
			}
			await this.#client.checkoutBranch(branch, {
				cwd: workingDirectory,
				...(kind === "remote" ? { track: true } : {}),
			});
		} catch (error) {
			throw checkoutErrorToFeatureError(error);
		}
	}

	/**
	 * Initialize the working directory as a git repository (Desktop parity:
	 * one `git -c init.defaultBranch=<branch> init`, the branch from the
	 * global config falling back to `main`, no initial commit). Idempotent —
	 * reinitializing an existing repository is a harmless no-op that leaves
	 * HEAD untouched.
	 */
	async init(workingDirectory: string): Promise<void> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			await this.#client.initRepository({ cwd: workingDirectory });
		} catch (error) {
			throw gitNotDetectedToFeatureError(error);
		}
	}

	/**
	 * Generate the complete working-tree patch for `cwd` without touching the
	 * user's real index (git-client stages into a throwaway temp index).
	 * `null` = not a git repository. The caller owns the returned patch file:
	 * `releasePatch(patchPath)` removes it (the protocol handler hooks
	 * stream close for that), and anything still in flight at teardown is
	 * swept by {@link dispose}.
	 */
	async createPatch(options: { readonly cwd: string }): Promise<GitPatchFile | null> {
		await this.#assertWithinWorkspaceFolders(options.cwd);
		try {
			const patch = await this.#client.createWorkingDirectoryPatch({
				cwd: options.cwd,
				...(this.#tempDir ? { tempDir: this.#tempDir } : {}),
			});
			if (patch === null) return null;
			this.#inFlightPatchPaths.add(patch.patchPath);
			return patch;
		} catch (error) {
			if (error instanceof GitNotDetectedError) {
				throw new FeatureError(
					"Git executable not found. Install git and make sure it is on your PATH.",
					"BUSINESS",
				);
			}
			throw error;
		}
	}

	/** Remove a patch file and release it from the dispose sweep. */
	async releasePatch(patchPath: string): Promise<void> {
		await rm(patchPath, { force: true });
		this.#inFlightPatchPaths.delete(patchPath);
	}

	/**
	 * Both sides of a working-tree file's contents for diff hunk expansion.
	 * Null sides mean that side is absent (new/untracked file, deleted file,
	 * unborn HEAD); a side over 50 MiB rejects with a `FeatureError`.
	 */
	async getDiffContents(options: {
		readonly workingDirectory: string;
		readonly path: string;
		readonly oldPath?: string | undefined;
	}): Promise<{ oldContents: string | null; newContents: string | null }> {
		await this.#assertWithinWorkspaceFolders(options.workingDirectory);
		assertInsideWorkingDirectory(options.workingDirectory, options.path);
		if (options.oldPath !== undefined) {
			assertInsideWorkingDirectory(options.workingDirectory, options.oldPath);
		}
		try {
			return await this.#client.getFileContents({
				cwd: options.workingDirectory,
				path: options.path,
				...(options.oldPath ? { oldPath: options.oldPath } : {}),
			});
		} catch (error) {
			if (error instanceof GitNotDetectedError) {
				throw new FeatureError(
					"Git executable not found. Install git and make sure it is on your PATH.",
					"BUSINESS",
				);
			}
			if (error instanceof GitFileTooLargeError) {
				throw new FeatureError(`"${error.path}" is too large to expand.`, "BUSINESS");
			}
			throw error;
		}
	}

	/** Best-effort sweep of in-flight patch files (plugin teardown). */
	async dispose(): Promise<void> {
		for (const patchPath of [...this.#inFlightPatchPaths]) {
			await this.releasePatch(patchPath).catch(() => undefined);
		}
	}

	async available(): Promise<boolean> {
		try {
			// Declared `Promise<string>`, but the probe does not trust the
			// declared type across the client seam: a falsey resolved value
			// means no usable version, so it collapses to `false` too.
			return Boolean(await this.#client.version());
		} catch {
			return false;
		}
	}

	/**
	 * The repository's default branch name: the `origin/HEAD` symref short
	 * name, else a local `main`, else `master` (t3code's chain, trimmed).
	 * `null` means no candidate — callers fall back to the current HEAD.
	 */
	async defaultBranch(workingDirectory: string): Promise<string | null> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			const remote = await this.#client.defaultBranch({ cwd: workingDirectory });
			if (remote !== null) return remote;

			const branches = await this.#client.branches({ cwd: workingDirectory });
			const names = branches?.map((branch) => branch.name) ?? [];
			if (names.includes("main")) return "main";
			if (names.includes("master")) return "master";
			return null;
		} catch (error) {
			throw gitNotDetectedToFeatureError(error);
		}
	}

	/**
	 * Create a chat worktree at `<main root>/.kilo/worktrees/` on a fresh
	 * `kilo/<friendly-words>` branch, based on `baseBranch` (else the
	 * default-branch chain, else the current HEAD). Returns the worktree
	 * directory and the new branch name.
	 */
	async createWorktree(input: {
		workingDirectory: string;
		baseBranch?: string;
	}): Promise<GitWorktreeResult> {
		return this.#worktrees.createWorktree(input);
	}

	/**
	 * Rename a worktree's branch to a semantic name derived from
	 * `requestedBranch` (naming policy: sanitize, `kilo/` prefix, 50-char
	 * cap). Ports kilocode's guard chain; every guard declines with `null`
	 * (rename is best-effort), unexpected failures throw.
	 */
	async renameWorktreeBranch(input: {
		path: string;
		currentBranch: string;
		requestedBranch: string;
	}): Promise<{ branch: string } | null> {
		return this.#worktrees.renameWorktreeBranch(input);
	}

	/**
	 * Remove a managed chat worktree, deleting its branch when it still
	 * carries the `kilo/` ownership marker. Idempotent: a path that is
	 * already gone or never registered resolves success; an unmanaged path
	 * is refused loudly.
	 */
	async removeWorktree(input: { path: string }): Promise<void> {
		return this.#worktrees.removeWorktree(input);
	}

	/**
	 * True when the worktree at `directory` has actual work relative to
	 * `baseBranch`: uncommitted file changes (staged, unstaged, or untracked)
	 * or commits ahead of the base. Two-tier contract, per the channel:
	 * a containment refusal rejects with a `VALIDATION` FeatureError (the
	 * directory is renderer-supplied, same deliberate choke point as every
	 * sibling method), while every git-level failure — missing binary, spawn
	 * failure, not a repo — resolves `false` (absence of evidence is not
	 * generation, same collapsing precedent as `available()`; git-client logs
	 * the probe detail via the adapted logger at the source).
	 */
	async hasWorktreeWork(input: { directory: string; baseBranch?: string }): Promise<boolean> {
		await this.#assertWithinWorkspaceFolders(input.directory);
		try {
			const status = await this.#client.status({ cwd: input.directory });
			if (status === null) return false;
			if (status.workingDirectory.files.length > 0) return true;
			if (!input.baseBranch) return false;
			// Leading-dash guard before interpolation into the rev-list args array.
			if (input.baseBranch.startsWith("-")) return false;
			const result = await this.#client
				.exec(["rev-list", "--count", `${input.baseBranch}..HEAD`], "revListCount", {
					cwd: input.directory,
					successExitCodes: new Set([0, 128]),
				})
				.catch(() => null);
			return result !== null && result.exitCode === 0 && parseInt(result.stdout.trim(), 10) > 0;
		} catch {
			return false;
		}
	}
}
