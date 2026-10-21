import { randomUUID } from "node:crypto";
import {
	appendFile,
	mkdir,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, normalize, resolve } from "node:path";
import process from "node:process";

import pLimit from "p-limit";
import type { LimitFunction } from "p-limit";

import type { MainSdkLogger } from "@kilo-desktop/feature-sdk";
import { FeatureError } from "@kilo-desktop/feature-sdk";

import {
	GitErrorCode,
	GitNotDetectedError,
	UnsupportedGitVersionError,
	isGitError,
} from "@kilo-desktop/git-client";

import { KILO_WORKTREE_SEGMENTS } from "../contracts/schemas.js";
import type { GitWorktreeResult } from "../contracts/schemas.js";
import { availableBranchName, generateBranchName, semanticBranchName } from "./branch-naming.js";
import type { BranchNameRandom } from "./branch-naming.js";
import type { GitClientSlice } from "./git-service.js";
import { unsupportedGitVersionToFeatureError } from "./unsupported-git-version.js";

/**
 * User-facing copy for a git binary that could not be resolved. git-client
 * memoizes the failed resolution for the client's lifetime, so installing
 * git only takes effect after a restart — the copy says so.
 */
export const GIT_NOT_FOUND_MESSAGE = "Git was not found. Install Git, then restart Kilo Desktop.";

/**
 * Worktree failures are user-facing copy (missing base branch, locked
 * worktree, …): git's parsed description must survive the IPC boundary, so
 * `GitError`s map to `FeatureError`s instead of being scrubbed to a
 * generic string.
 */
function worktreeErrorToFeatureError(error: unknown): unknown {
	if (error instanceof FeatureError) return error;
	if (isGitError(error)) {
		return new FeatureError(error.result.gitErrorDescription ?? error.message, "BUSINESS");
	}
	if (error instanceof GitNotDetectedError) {
		return new FeatureError(GIT_NOT_FOUND_MESSAGE, "BUSINESS");
	}
	if (error instanceof UnsupportedGitVersionError) {
		return unsupportedGitVersionToFeatureError(error);
	}
	return error;
}

/**
 * Worktree ownership and lifecycle for the git plugin.
 *
 * Worktree ownership model (kilocode's conventions, adapted):
 * - Chat worktrees live at `<main worktree root>/.kilo/worktrees/<name>`,
 *   where `<main worktree root>` is the first entry of
 *   `git worktree list --porcelain` (block 0, linked-worktree-safe) and
 *   `<name>` is the branch with `/` flattened to `-`. The
 *   `.kilo/worktrees/` line is appended to `<git common dir>/info/exclude`
 *   so the worktrees never show as untracked noise.
 * - Branches created here carry the `kilo/` prefix as a stateless ownership
 *   marker: it scopes rename eligibility, and `removeWorktree` deletes the
 *   branch only when its git-read current name still has it. The LLM rename
 *   keeps the prefix (`semanticBranchName(slug, "kilo")`), so the marker
 *   survives renames while the directory keeps its original friendly name.
 * - `createWorktree`/`removeWorktree` are idempotent-or-loud: removal reaches
 *   its goal state (worktree gone, `kilo/` branch gone) through early
 *   returns and inferred-branch deletion when the registration is already
 *   missing. Any path that is not a direct child of the managed directory
 *   is refused with a `FeatureError` rather than acted on.
 * - `renameWorktreeBranch` ports kilocode's guard chain (managed path →
 *   HEAD still on `currentBranch` → no upstream → not on a remote →
 *   requested name differs and is valid → deduped against local and remote
 *   names). Every guard declines with `null` — rename is best-effort —
 *   while unexpected git failures throw.
 * - Caller paths are canonicalized via `realpath` (falling back to lexical
 *   `resolve` when the path no longer exists) before matching against git's
 *   porcelain output: `git worktree list --porcelain` realpath-resolves its
 *   registrations, so a symlink-aliased input (macOS /tmp → /private/tmp)
 *   would otherwise silently fail to match (kilocode's `canonicalizePath`).
 *   On Windows the match is case-insensitive: git and Node often disagree
 *   on drive-letter / directory casing, and a miss used to no-op removal.
 * - The VS Code Agent Manager shares `.kilo/worktrees/` and adopts every
 *   worktree it finds there; `linkAgentManagerSession` writes its per-worktree
 *   session file so a Desktop worktree shows its session instead of an
 *   empty entry. Writes are create-only, so Agent Manager's own file wins.
 *
 * Concurrency and caches (kilocode's WorktreeManager, adapted): worktree
 * mutations serialize per repository through a `pLimit(1)` mutex keyed by
 * the main worktree root — create arrives with the workspace primary while
 * rename/remove arrive with the worktree path; one read-only listing
 * resolves both to the same key. Read-only probes (repository type, LFS)
 * run outside the lock. Successful base fetches are cached for 60s per
 * `<repo>:<remote>:<branch>` so rapid session creates refetch at most once;
 * the git-lfs binary probe memoizes for the manager's lifetime.
 * Cross-process races (the kilo CLI on the same repo) are covered by the
 * one-shot already-exists retry, not the lock.
 */

/** Post-checkout hook failure signature (kilocode's `isHookError`). */
function isHookError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /hook|husky|lefthook/i.test(message) && /post[-_]checkout/i.test(message);
}

/** "already exists" failures (branch or path collision) are retryable once. */
function isAlreadyExistsError(error: unknown): boolean {
	return error instanceof Error && /already exists/i.test(error.message);
}

/**
 * Strict safe-name check for remotes interpolated into fetch refspecs
 * (kilocode's injection guard for `git remote` output): git remote names
 * never contain `/`, spaces, or a leading dash.
 */
function isSafeRemoteName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(name);
}

/**
 * Non-interactive env overlay for fetches (kilocode's `nonInteractiveEnv`):
 * an offline or auth-challenged remote must fail fast into the warning
 * path instead of blocking session creation on a credential prompt. The
 * user's own `GIT_SSH_COMMAND` always wins over our BatchMode default.
 */
function nonInteractiveFetchEnv(): Record<string, string> {
	return {
		GIT_TERMINAL_PROMPT: "0",
		...(process.env.GIT_SSH_COMMAND === undefined
			? { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" }
			: {}),
	};
}

/** How long a successful base fetch stays fresh (kilocode's fetch TTL). */
const FETCH_TTL_MS = 60_000;

/** Shape of one `#lfsProbe` cache entry. */
interface LfsProbeEntry {
	promise: Promise<boolean>;
	resolvedValue?: boolean;
	at: number;
}

/**
 * Background deletion options for worktree directories (kilocode's
 * `RM_OPTS`): Windows AV scanners and indexers hold handles briefly, so
 * `rm` retries EBUSY-class failures instead of racing them.
 */
const RM_OPTS = { recursive: true, force: true, maxRetries: 3, retryDelay: 200 } as const;

/**
 * Rename retries after session delete: the kilo CLI may still hold the
 * worktree as cwd for a beat, and Windows refuses to rename a process cwd
 * (EBUSY/EPERM). Instant fallback to `git worktree remove` hits the same
 * lock; waiting out the handle is the path that actually reaches the goal.
 */
const RENAME_RETRY = { attempts: 8, delayMs: 250 } as const;

/** Branch deletion retries after session delete: the kilo CLI may still hold
 *  a git lock, and a renamed worktree can stay "in use" until prune lands. */
const BRANCH_DELETE_RETRY = { attempts: 8, delayMs: 250 } as const;

/** Prefix for directories pending background deletion (kilocode). */
const DELETE_TEMP_PREFIX = ".kilo-delete-";

/**
 * True when `target` is a direct child of `<mainRoot>/.kilo/worktrees/`
 * (kilocode's managed-path guard): the exact-parent comparison rules out
 * sibling-prefix confusions like a `worktrees-evil` directory.
 */
function isManagedWorktreePath(target: string, mainRoot: string): boolean {
	const worktreesDir = resolve(mainRoot, ...KILO_WORKTREE_SEGMENTS);
	return sameWorktreePath(dirname(resolve(target)), worktreesDir);
}

/** Git/Node path equality: case-insensitive on Windows, normalized everywhere. */
function sameWorktreePath(left: string, right: string): boolean {
	const a = normalize(left);
	const b = normalize(right);
	if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase();
	return a === b;
}

function isBusyFsError(error: unknown): boolean {
	const code =
		error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
	return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "ENOTEMPTY";
}

function gitErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRetryableBranchDeleteError(error: unknown): boolean {
	if (isGitError(error, GitErrorCode.LockFileAlreadyExists)) return true;
	return /used by worktree|another git process seems to be running/i.test(gitErrorMessage(error));
}

function isMissingBranchError(error: unknown): boolean {
	return /not found|no such branch/i.test(gitErrorMessage(error));
}

/** Invert `branch.replaceAll("/", "-")` for the `kilo/<slug>` ownership marker. */
function kiloBranchFromManagedDir(dirName: string): string | null {
	if (!dirName.startsWith("kilo-")) return null;
	const slug = dirName.slice("kilo-".length);
	return slug.length > 0 ? `kilo/${slug}` : null;
}

/**
 * Canonicalize a caller-supplied worktree path before matching it against
 * `git worktree list --porcelain` output: git realpath-resolves its
 * registrations, so the probe side must be canonical too (kilocode's
 * `canonicalizePath`) — a symlink-aliased input (macOS /tmp, /var)
 * otherwise silently fails to match. Falls back to lexical `resolve` when
 * the path no longer exists (idempotent removal retry).
 */
async function canonicalizePath(path: string): Promise<string> {
	return realpath(path).catch(() => resolve(path));
}

/** Directory entry names, or `[]` when the directory does not exist yet. */
async function readDirNames(directory: string): Promise<string[]> {
	return readdir(directory).catch(() => []);
}

/**
 * The VS Code extension's Agent Manager discovers every worktree under
 * `.kilo/worktrees/`, but attaches a session to one only through this file
 * in the worktree's git admin directory. Without it, Desktop worktrees show
 * up there as entries with no sessions.
 */
const AGENT_MANAGER_METADATA_FILE = "kilo-agent-manager-metadata.json";

/**
 * The linked worktree's git admin directory, read from the `gitdir:` line of
 * its `.git` file the way Agent Manager resolves it (relative paths resolve
 * against the worktree). `null` when the worktree has no `.git` file.
 */
async function linkedWorktreeGitDir(worktreePath: string): Promise<string | null> {
	const content = await readFile(join(worktreePath, ".git"), "utf-8").catch(() => null);
	const match = content?.match(/^gitdir:\s*(.+)$/m);
	return match?.[1] ? resolve(worktreePath, match[1].trim()) : null;
}

function isFileExistsError(error: unknown): boolean {
	return error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST";
}

/** Resolve `false` instead of rejecting — for best-effort probes. */
function pBool(promise: Promise<unknown>): Promise<boolean> {
	return promise.then(
		() => true,
		() => false,
	);
}

export interface WorktreeManagerOptions {
	readonly client: GitClientSlice;
	readonly logger: MainSdkLogger;
	/** Random source for branch generation. Injectable for deterministic tests. */
	readonly random?: BranchNameRandom;
	/** fs.rename seam (removal's atomic first step); injectable in tests. */
	readonly renameDirectory?: (from: string, to: string) => Promise<void>;
	/** fs.rm seam (background temp/dir deletion); injectable in tests. */
	readonly removeDirectory?: (target: string) => Promise<void>;
	/** Delay seam for rename retries; injectable so tests do not wait. */
	readonly sleep?: (ms: number) => Promise<void>;
	/**
	 * Resolves the repository's default branch. Mirrors `GitService.defaultBranch`'s
	 * chain: remote `origin/HEAD` symref short name, else local `main`, else `master`.
	 */
	readonly resolveDefaultBranch: (workingDirectory: string) => Promise<string | null>;
	/**
	 * How long a negative LFS probe result stays fresh (milliseconds).
	 * Positive results are cached permanently (LFS won't be uninstalled mid-session).
	 * Defaults to 300_000 (5 minutes). Injectable so tests can use a short TTL.
	 */
	readonly lfsReprobeTtl?: number;
}

export class WorktreeManager {
	readonly #client: GitClientSlice;
	readonly #logger: MainSdkLogger;
	readonly #random: BranchNameRandom;
	readonly #renameDirectory: (from: string, to: string) => Promise<void>;
	readonly #removeDirectory: (target: string) => Promise<void>;
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #resolveDefaultBranch: (workingDirectory: string) => Promise<string | null>;
	readonly #lfsReprobeTtl: number;
	/**
	 * Per-repo operation mutexes: keyed by main worktree root. Each entry is a
	 * `pLimit(1)` instance that serializes mutations for that repository; a
	 * rejected operation releases the slot in a `finally` so it never blocks
	 * the next caller.
	 */
	readonly #locks = new Map<string, LimitFunction>();
	/**
	 * Successful base fetches keyed `${mainRoot}:${remote}:${branch}` with
	 * their timestamps (kilocode's fetch TTL cache), so rapid successive
	 * session creates refetch at most once per minute per base.
	 */
	readonly #fetchCache = new Map<string, number>();
	/**
	 * TTL-aware `git lfs version` probe cache (kilocode's LFS check, adapted):
	 * positive results are permanent (LFS won't be uninstalled mid-session);
	 * negative results expire after `#lfsReprobeTtl` so a mid-session
	 * install is picked up on the next probe. The resolved value is captured
	 * synchronously via `void promise.then(...)` so the TTL check never has
	 * to await the settled promise.
	 */
	#lfsProbe: LfsProbeEntry | undefined;

	constructor(options: WorktreeManagerOptions) {
		this.#client = options.client;
		this.#logger = options.logger;
		this.#random = options.random ?? Math.random;
		this.#renameDirectory = options.renameDirectory ?? ((from, to) => rename(from, to));
		this.#removeDirectory = options.removeDirectory ?? ((target) => rm(target, { ...RM_OPTS }));
		this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.#resolveDefaultBranch = options.resolveDefaultBranch;
		this.#lfsReprobeTtl = options.lfsReprobeTtl ?? 300_000;
	}

	/** Run `fn` serialized against every other mutation on the same repository. */
	#withGitLock<T>(repoKey: string, fn: () => Promise<T>): Promise<T> {
		let limit = this.#locks.get(repoKey);
		if (limit === undefined) {
			limit = pLimit(1);
			this.#locks.set(repoKey, limit);
		}
		return limit(fn);
	}

	/**
	 * The lock key for an incoming path: the repository's main worktree
	 * root, not the path itself — create arrives with the workspace
	 * primary while rename/remove arrive with the worktree path, and all
	 * three target the same repository. One read-only listing resolves
	 * it; a listing failure falls back to the resolved path so the
	 * mutation still serializes (or fails as it would have anyway).
	 */
	async #repoLockKey(cwd: string): Promise<string> {
		const listing = await this.#client.worktrees({ cwd }).catch(() => null);
		return listing?.[0]?.path ?? resolve(cwd);
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
		try {
			return await this.#createWorktreeInner(input);
		} catch (error) {
			throw worktreeErrorToFeatureError(error);
		}
	}

	async #createWorktreeInner(input: {
		workingDirectory: string;
		baseBranch?: string;
	}): Promise<GitWorktreeResult> {
		const { workingDirectory, baseBranch } = input;
		const repositoryType = await this.#client.repositoryType(workingDirectory);
		if (repositoryType.kind !== "regular") {
			throw new FeatureError("Worktrees need a regular git repository.", "BUSINESS");
		}

		// LFS pre-flight (kilocode): a worktree in an LFS repo without the
		// git-lfs binary produces pointer files on checkout — refuse up
		// front instead of corrupting the working tree.
		if (await this.#repoUsesLfs(workingDirectory, repositoryType.topLevelWorkingDirectory)) {
			if (!(await this.#checkLfsAvailable())) {
				throw new FeatureError(
					"This repository uses Git LFS, but git-lfs was not found. Install Git LFS to create worktrees here.",
					"BUSINESS",
				);
			}
		}

		// Block 0 of the porcelain listing is the main worktree, which
		// anchors the managed directory even when the workspace itself
		// is a linked worktree.
		const worktrees = await this.#client.worktrees({ cwd: workingDirectory });
		const mainRoot = worktrees[0]?.path;
		if (mainRoot === undefined) {
			throw new FeatureError("Could not resolve the main worktree of this repository.", "BUSINESS");
		}
		const worktreesDir = join(mainRoot, ...KILO_WORKTREE_SEGMENTS);

		return this.#withGitLock(mainRoot, () =>
			this.#createWorktreeLocked({
				workingDirectory,
				mainRoot,
				worktreesDir,
				...(baseBranch === undefined ? {} : { baseBranch }),
			}),
		);
	}

	/**
	 * The mutating half of `createWorktree`, already holding the repo lock
	 * (kilocode's order): resolve the effective base name, validate it,
	 * fetch it from the remote (best-effort — failure only warns), then
	 * pick the branch, write the exclude, and add the worktree — with
	 * kilocode's hook tolerance and one-shot already-exists retry
	 * (cross-process races with e.g. the kilo CLI are invisible to the
	 * in-process lock, so the retry covers them).
	 */
	async #createWorktreeLocked(input: {
		workingDirectory: string;
		mainRoot: string;
		worktreesDir: string;
		baseBranch?: string;
	}): Promise<GitWorktreeResult> {
		const { workingDirectory, mainRoot, worktreesDir, baseBranch } = input;
		const baseName = baseBranch ?? (await this.#resolveDefaultBranch(workingDirectory));
		let warning: string | undefined;
		let remote: string | undefined;
		if (baseName !== null && baseName !== undefined) {
			await this.#validateBaseBranch(workingDirectory, baseName);
			({ warning, remote } = await this.#fetchBaseIfStale({
				workingDirectory,
				mainRoot,
				baseName,
			}));
		}
		// The remote-tracking ref is fresh only when the fetch happened (or
		// the TTL cache answered for) a remote that has it.
		const freshRemoteBase = remote !== undefined && warning === undefined;

		for (let attempt = 0; ; attempt++) {
			const branch = await this.#pickBranchName(workingDirectory, worktreesDir);
			const directory = join(worktreesDir, branch.replaceAll("/", "-"));
			const baseRef = await this.#resolveBaseRef(workingDirectory, baseName, {
				remote,
				freshRemoteBase,
			});

			// Before registering anything: the exclude entry is harmless when
			// no worktree exists yet, but a failed write after `addWorktree`
			// would leak a registered worktree behind a rejected call.
			await this.#ensureGitExclude(workingDirectory);

			try {
				await this.#client.addWorktree(directory, {
					cwd: workingDirectory,
					createBranch: branch,
					// Dereferenced to `<ref>^{commit}` (kilocode): a resolved start
					// point must anchor the new branch at a commit — `worktree add
					// -b` from a remote-tracking ref would otherwise set upstream
					// tracking on the branch, which then makes every semantic
					// rename decline on the no-upstream guard.
					...(baseRef === undefined ? {} : { commitish: `${baseRef}^{commit}` }),
				});
			} catch (error) {
				// Post-checkout hooks (husky/lefthook) can exit non-zero after a
				// successful registration — only a hook-shaped failure on a
				// registered worktree is tolerated; anything else surfaces
				// even when the path happens to be registered (kilocode).
				if (isHookError(error)) {
					const registered = await this.#client
						.worktrees({ cwd: workingDirectory })
						.then((entries) => entries.some((entry) => entry.path === directory))
						.catch(() => false);
					if (registered) {
						return {
							directory,
							branch,
							...(warning === undefined ? {} : { warning }),
							...(baseRef === undefined ? {} : { baseRef }),
						};
					}
				}
				if (attempt === 0 && isAlreadyExistsError(error)) continue;
				throw error;
			}

			return {
				directory,
				branch,
				...(warning === undefined ? {} : { warning }),
				...(baseRef === undefined ? {} : { baseRef }),
			};
		}
	}

	/**
	 * Validate a renderer-supplied base branch name before it reaches any
	 * git argument slot (kilocode's `validateGitRef` concern): names are
	 * probed with `check-ref-format --branch`, but a leading dash is
	 * rejected outright — it would be parsed as a flag even by the probe.
	 */
	async #validateBaseBranch(workingDirectory: string, baseName: string): Promise<void> {
		if (baseName.startsWith("-")) {
			throw new FeatureError(`"${baseName}" is not a valid branch name.`, "VALIDATION");
		}
		const valid = await this.#client.checkRefFormat(baseName, { cwd: workingDirectory });
		if (!valid) {
			throw new FeatureError(`"${baseName}" is not a valid branch name.`, "VALIDATION");
		}
	}

	/**
	 * The fetch half of base preparation: resolve the remote (`origin`,
	 * else the first), and refresh `refs/remotes/<remote>/<base>` unless
	 * the TTL cache already holds a fetch from the last minute. Local-only
	 * repositories skip silently; a failed fetch never blocks creation —
	 * it only produces the "branched from local state" warning.
	 */
	async #fetchBaseIfStale(input: {
		workingDirectory: string;
		mainRoot: string;
		baseName: string;
	}): Promise<{ warning?: string; remote?: string }> {
		const { workingDirectory, mainRoot, baseName } = input;
		const remote = await this.#repoRemote(workingDirectory);
		if (remote === undefined) return {};

		const cacheKey = `${mainRoot}:${remote}:${baseName}`;
		const cachedAt = this.#fetchCache.get(cacheKey);
		if (cachedAt !== undefined && Date.now() - cachedAt < FETCH_TTL_MS) {
			return { remote };
		}

		// `baseName` is validated by `#validateBaseBranch` (`git check-ref-format --branch`),
		// which rejects every refspec metacharacter (`:`, `..`, `@{`, whitespace, glob chars),
		// and `remote` by `isSafeRemoteName` — direct interpolation into the refspec is safe
		// (GitHub Desktop and kilocode do the same). Exec is argv-array; no shell is involved.
		const fetched = await pBool(
			this.#client.exec(
				[
					"fetch",
					"--quiet",
					"--no-tags",
					remote,
					`+refs/heads/${baseName}:refs/remotes/${remote}/${baseName}`,
				],
				"fetchBaseBranch",
				{ cwd: workingDirectory, env: nonInteractiveFetchEnv() },
			),
		);
		if (!fetched) {
			return {
				remote,
				warning: `Could not fetch latest ${baseName} from ${remote}; branched from local state.`,
			};
		}
		this.#fetchCache.set(cacheKey, Date.now());
		return { remote };
	}

	/**
	 * The fetch remote: `origin` when present, else the first remote,
	 * else `undefined` (local-only). Probe failures collapse to
	 * `undefined` — the fetch is best-effort, never a blocker.
	 */
	async #repoRemote(workingDirectory: string): Promise<string | undefined> {
		const remotes = await this.#client.remotes({ cwd: workingDirectory }).then(
			(names) => names.filter((name) => isSafeRemoteName(name)),
			() => [] as string[],
		);
		if (remotes.length === 0) return undefined;
		return remotes.includes("origin") ? "origin" : remotes[0];
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
		try {
			const path = await canonicalizePath(input.path);
			const repoKey = await this.#repoLockKey(path);
			return await this.#withGitLock(repoKey, () =>
				this.#renameWorktreeBranchLocked({ ...input, path }),
			);
		} catch (error) {
			throw worktreeErrorToFeatureError(error);
		}
	}

	async #renameWorktreeBranchLocked(input: {
		path: string;
		currentBranch: string;
		requestedBranch: string;
	}): Promise<{ branch: string } | null> {
		const { path: worktreePath, currentBranch, requestedBranch } = input;
		const listing = await this.#client.worktrees({ cwd: worktreePath });
		const mainRoot = listing[0]?.path;
		if (mainRoot === undefined || !isManagedWorktreePath(worktreePath, mainRoot)) {
			return null;
		}

		// A null result means the path is no longer a git repository — decline silently.
		const status = await this.#client.status({ cwd: worktreePath });
		if (status === null) return null;
		const actual = status.currentBranch;
		if (actual === undefined || actual !== currentBranch) return null;

		// Fetch local and remote refs in parallel — both upstream and remote-on-branch
		// guards need them, and a null result means the repository is gone.
		const [locals, remoteEntries] = await Promise.all([
			this.#client.branches({ cwd: worktreePath }),
			this.#client.branches({ cwd: worktreePath, prefixes: ["refs/remotes"] }),
		]);
		if (locals === null) return null;
		if (remoteEntries === null) return null;

		// Upstream guard: a missing local entry is treated as no upstream;
		// `branch -m` remains the final arbiter.
		const local = locals.find((b) => b.name === currentBranch);
		if (local?.upstream !== null && local?.upstream !== undefined) return null;

		// Remote-on-branch guard: names are the ref minus `refs/remotes/`
		// (e.g. origin/main); symrefs (origin/HEAD) are excluded — harmless here.
		const remotes = remoteEntries.map((b) => b.name);
		if (remotes.some((ref) => ref.endsWith(`/${currentBranch}`))) return null;

		const base = semanticBranchName(requestedBranch.trim(), "kilo");
		if (!base || base === currentBranch) return null;

		const valid = await this.#client.checkRefFormat(base, { cwd: worktreePath });
		if (!valid) return null;

		const localNames = new Set(locals.map((branch) => branch.name));
		const remoteNames = new Set(remotes.map((ref) => ref.replace(/^[^/]+\//, "")));
		const available = (name: string) => !localNames.has(name) && !remoteNames.has(name);
		const branch = available(base)
			? base
			: Array.from({ length: 10_000 }, (_, index) => `${base}-${index + 2}`).find(available);
		if (!branch) return null;

		await this.#client.renameBranch(currentBranch, branch, { cwd: worktreePath });
		return { branch };
	}

	/**
	 * Remove a managed chat worktree, deleting its branch when it still
	 * carries the `kilo/` ownership marker. Idempotent: a path that is
	 * already gone or never registered still drops the inferred `kilo/`
	 * branch; an unmanaged path is refused loudly.
	 */
	async removeWorktree(input: { path: string }): Promise<void> {
		try {
			const path = await canonicalizePath(input.path);
			const repoKey = await this.#repoLockKey(path);
			await this.#withGitLock(repoKey, () => this.#removeWorktreeLocked({ path }));
		} catch (error) {
			throw worktreeErrorToFeatureError(error);
		}
	}

	/**
	 * The removal flow, already holding the repo lock (kilocode's
	 * `removeWorktreeImpl`): rename the directory to a temp sibling first —
	 * same parent ⇒ same filesystem ⇒ atomic, and the goal state (path
	 * gone) is reached even while file handles are still open on Windows.
	 * Then prune the stale registration, delete the branch when it carries
	 * the marker, and delete the temp directory in the background.
	 *
	 * A failed rename (cross-device, locked) falls back to the
	 * pre-hardening behavior: `git worktree remove --force`, a best-effort
	 * `rm` of the original path, and a prune.
	 */
	async #removeWorktreeLocked(input: { path: string }): Promise<void> {
		const { path: worktreePath } = input;
		// Session teardown can already have removed the directory, so a
		// listing from the worktree path fails; walk up to the parent so
		// we can still drop the kilo/ branch instead of leaking it.
		const listing =
			(await this.#client.worktrees({ cwd: worktreePath }).catch(() => null)) ??
			(await this.#client.worktrees({ cwd: dirname(worktreePath) }).catch(() => null));
		if (listing === null) return;

		const entry = listing.find((item) => sameWorktreePath(item.path, worktreePath));
		const mainRoot = listing[0]?.path;
		if (mainRoot === undefined) return;
		if (!isManagedWorktreePath(worktreePath, mainRoot)) {
			if (entry === undefined) return;
			throw new FeatureError(
				"Refusing to remove this directory: it is not a Kilo-managed worktree.",
				"BUSINESS",
			);
		}

		// The branch is read from the fresh listing (git's truth, not any
		// session stamp), so branches renamed after the stamp still work.
		// When the registration is already gone, invert the managed
		// directory name (`kilo-<slug>` → `kilo/<slug>`).
		const branchFromListing = entry?.branch?.startsWith("refs/heads/")
			? entry.branch.slice("refs/heads/".length)
			: null;
		const branch = branchFromListing ?? kiloBranchFromManagedDir(basename(worktreePath));

		if (entry !== undefined) {
			const tempTarget = join(
				dirname(resolve(worktreePath)),
				`${DELETE_TEMP_PREFIX}${randomUUID()}`,
			);
			const renamed = await this.#renameAway(worktreePath, tempTarget);

			if (renamed) {
				// The directory is already gone from its original path; prune only
				// drops git's now-stale registration.
				await this.#pruneWorktrees(mainRoot);
				void this.#deleteInBackground(tempTarget);
			} else {
				await this.#client.removeWorktree(worktreePath, { cwd: mainRoot, force: true });
				await this.#pruneWorktrees(mainRoot);
				void this.#deleteInBackground(worktreePath);
			}
		} else {
			await this.#pruneWorktrees(mainRoot);
		}

		if (branch !== null && branch.startsWith("kilo/")) {
			await this.#deleteOwnedBranch(branch, mainRoot);
		}
	}

	/**
	 * Attach a Kilo session to a managed chat worktree for the VS Code Agent
	 * Manager by writing its metadata file into the worktree's git admin
	 * directory (git deletes it along with the worktree). An existing file is
	 * never overwritten — Agent Manager or an earlier link owns it — so
	 * repeated calls are safe. Resolves `true` only when this call wrote the
	 * file; unregistered or unmanaged paths decline with `false`.
	 */
	async linkAgentManagerSession(input: {
		path: string;
		sessionId: string;
		baseRef?: string;
	}): Promise<boolean> {
		const worktreePath = await canonicalizePath(input.path);
		// Backfill walks every historical session; a deleted worktree must not
		// cost a git spawn.
		if (!(await pBool(stat(worktreePath)))) return false;
		const listing = await this.#client.worktrees({ cwd: worktreePath }).catch(() => null);
		const mainRoot = listing?.[0]?.path;
		if (mainRoot === undefined || !isManagedWorktreePath(worktreePath, mainRoot)) return false;
		if (!listing?.some((entry) => sameWorktreePath(entry.path, worktreePath))) return false;

		const gitDir = await linkedWorktreeGitDir(worktreePath);
		if (gitDir === null) return false;

		const base = input.baseRef ? await this.#splitBaseRef(worktreePath, input.baseRef) : {};
		const metadata = { sessionId: input.sessionId, ...base };
		try {
			await writeFile(join(gitDir, AGENT_MANAGER_METADATA_FILE), JSON.stringify(metadata), {
				encoding: "utf-8",
				flag: "wx",
			});
			return true;
		} catch (error) {
			if (isFileExistsError(error)) return false;
			throw error;
		}
	}

	/**
	 * Agent Manager stores the base as a bare branch plus its remote, so a
	 * remote-tracking ref (`origin/main`) is split only when its prefix is a
	 * real remote — `release/1.0` stays a local branch name.
	 */
	async #splitBaseRef(
		worktreePath: string,
		baseRef: string,
	): Promise<{ parentBranch: string; remote?: string }> {
		const remotes = await this.#client.remotes({ cwd: worktreePath }).catch(() => [] as string[]);
		const remote = remotes.find((name) => baseRef.startsWith(`${name}/`));
		if (remote === undefined) return { parentBranch: baseRef };
		return { parentBranch: baseRef.slice(remote.length + 1), remote };
	}

	/** Delete a `kilo/` branch, retrying lock / still-in-use races. */
	async #deleteOwnedBranch(branch: string, mainRoot: string): Promise<void> {
		for (let attempt = 0; attempt < BRANCH_DELETE_RETRY.attempts; attempt++) {
			try {
				await this.#client.deleteBranch(branch, { cwd: mainRoot });
				return;
			} catch (error) {
				if (isMissingBranchError(error)) return;
				if (!isRetryableBranchDeleteError(error) || attempt === BRANCH_DELETE_RETRY.attempts - 1) {
					throw error;
				}
				await this.#pruneWorktrees(mainRoot);
				await this.#sleep(BRANCH_DELETE_RETRY.delayMs);
			}
		}
	}

	/**
	 * Atomic first step of removal: rename the worktree to a temp sibling.
	 * Busy errors (Windows cwd/file lock after session delete) retry before
	 * falling back to `git worktree remove --force`.
	 */
	async #renameAway(from: string, to: string): Promise<boolean> {
		for (let attempt = 0; attempt < RENAME_RETRY.attempts; attempt++) {
			try {
				await this.#renameDirectory(from, to);
				return true;
			} catch (error) {
				if (!isBusyFsError(error) || attempt === RENAME_RETRY.attempts - 1) return false;
				await this.#sleep(RENAME_RETRY.delayMs);
			}
		}
		return false;
	}

	/** Best-effort prune of stale worktree registrations; failures are logged. */
	async #pruneWorktrees(mainRoot: string): Promise<void> {
		await this.#client.pruneWorktrees({ cwd: mainRoot }).catch((error: unknown) => {
			this.#logger.error(`Failed to prune worktrees: ${String(error)}`);
		});
	}

	/** Fire-and-forget directory deletion; never blocks or fails the caller. */
	#deleteInBackground(target: string): void {
		void this.#removeDirectory(target).catch((error: unknown) => {
			this.#logger.error(`Failed to delete ${target}: ${String(error)}`);
		});
	}

	/**
	 * Pick a `kilo/<friendly-words>` branch name deduped against existing
	 * `kilo/` branches and the on-disk worktrees directory (kilocode's
	 * `generateBranchName` + `availableBranch`). Reading the directory
	 * doubles as the sweep point for orphaned `.kilo-delete-*` temp dirs
	 * from crashed removals (kilocode's `cleanupOrphanedTempDirs`).
	 */
	async #pickBranchName(workingDirectory: string, worktreesDir: string): Promise<string> {
		const [branches, dirEntries] = await Promise.all([
			this.#client.branches({ cwd: workingDirectory }),
			readDirNames(worktreesDir),
		]);

		const existing = new Set<string>();
		for (const branch of branches ?? []) {
			if (branch.name.startsWith("kilo/")) existing.add(branch.name.slice("kilo/".length));
		}
		for (const entry of dirEntries) {
			if (entry.startsWith(DELETE_TEMP_PREFIX)) {
				void this.#deleteInBackground(join(worktreesDir, entry));
				continue;
			}
			if (entry.startsWith("kilo-")) existing.add(entry.slice("kilo-".length));
		}

		const slug = generateBranchName(undefined, [...existing], this.#random);
		return `kilo/${availableBranchName(slug, [...existing])}`;
	}

	/**
	 * Resolve the base ref for a new worktree (kilocode's `remoteRef`
	 * intent, adapted): the caller derefences it to `<ref>^{commit}` at the
	 * `addWorktree` call site so a remote-tracking start point never sets
	 * upstream tracking on the new branch, which would otherwise make
	 * every semantic rename decline on the no-upstream guard.
	 *
	 * Preference order: the freshly fetched `${remote}/${name}` first, then
	 * the fallback chain (local → the resolved remote's tracking ref → the
	 * `origin/` convention → the bare name, so git surfaces its own error
	 * for a deleted base). `undefined` means "current HEAD" (`worktree add`
	 * defaults to HEAD).
	 */
	async #resolveBaseRef(
		workingDirectory: string,
		baseName: string | null | undefined,
		base: { remote: string | undefined; freshRemoteBase: boolean },
	): Promise<string | undefined> {
		if (baseName === null || baseName === undefined) return undefined;
		const remoteBase = base.remote === undefined ? undefined : `${base.remote}/${baseName}`;

		// Remote ref names are the ref minus `refs/remotes/` (e.g. origin/main);
		// symrefs (origin/HEAD) are excluded. A null result falls through to the
		// bare-name ref so git surfaces its own error for a deleted base.
		const [branches, remoteEntries] = await Promise.all([
			this.#client.branches({ cwd: workingDirectory }),
			this.#client.branches({ cwd: workingDirectory, prefixes: ["refs/remotes"] }),
		]);
		const localNames = new Set((branches ?? []).map((branch) => branch.name));
		const remoteRefs = (remoteEntries ?? []).map((b) => b.name);

		if (base.freshRemoteBase && remoteBase !== undefined && remoteRefs.includes(remoteBase)) {
			return remoteBase;
		}
		if (localNames.has(baseName)) return baseName;
		if (remoteBase !== undefined && remoteRefs.includes(remoteBase)) {
			return remoteBase;
		}
		if (remoteRefs.includes(`origin/${baseName}`)) return `origin/${baseName}`;
		return baseName;
	}

	/**
	 * True when the repository is configured for Git LFS (kilocode's
	 * `repoUsesLfs`): the root `.gitattributes`, the common dir's
	 * `info/attributes`, or a populated `<common dir>/lfs` directory.
	 */
	async #repoUsesLfs(workingDirectory: string, root: string): Promise<boolean> {
		const rootAttributes = await readFile(join(root, ".gitattributes"), "utf-8").catch(() => "");
		if (rootAttributes.includes("filter=lfs")) return true;

		const commonDir = await this.#client.gitCommonDir({ cwd: workingDirectory });
		const infoAttributes = await readFile(join(commonDir, "info", "attributes"), "utf-8").catch(
			() => "",
		);
		if (infoAttributes.includes("filter=lfs")) return true;

		return pBool(stat(join(commonDir, "lfs")));
	}

	/**
	 * TTL-aware git-lfs binary probe (kilocode, adapted): `git lfs version`
	 * exits 0 when installed and 1 when not (git reports an unknown
	 * subcommand), so both codes resolve — only the code decides. Other
	 * failures (e.g. no git binary) collapse to `false`. Positive results
	 * are cached permanently; negative results expire after `#lfsReprobeTtl`
	 * so a mid-session install is picked up on the next call.
	 */
	#checkLfsAvailable(): Promise<boolean> {
		const probe = this.#lfsProbe;
		if (probe !== undefined) {
			// Positive results are permanent (LFS won't be uninstalled mid-session).
			if (probe.resolvedValue === true) return probe.promise;
			// Negative results expire after TTL so a mid-session install is picked up.
			if (Date.now() - probe.at < this.#lfsReprobeTtl) return probe.promise;
		}
		const promise = this.#client
			.exec(["lfs", "version"], "lfsVersionProbe", {
				successExitCodes: new Set([0, 1]),
			})
			.then(
				(r) => r.exitCode === 0,
				() => false,
			);
		const entry: LfsProbeEntry = { promise, at: Date.now() };
		// Capture the resolved value synchronously for the next TTL check.
		void promise.then((value) => {
			entry.resolvedValue = value;
		});
		this.#lfsProbe = entry;
		return promise;
	}

	/**
	 * Append `.kilo/worktrees/` to `<git common dir>/info/exclude` when
	 * absent (kilocode's `ensureGitExclude`, trimmed to the one entry).
	 */
	async #ensureGitExclude(workingDirectory: string): Promise<void> {
		const commonDir = await this.#client.gitCommonDir({ cwd: workingDirectory });
		const excludePath = join(commonDir, "info", "exclude");

		const content = await readFile(excludePath, "utf-8").catch(() => "");
		if (content.includes(".kilo/worktrees/")) return;

		await mkdir(dirname(excludePath), { recursive: true });
		const pad = content === "" || content.endsWith("\n") ? "" : "\n";
		await appendFile(excludePath, `${pad}\n# Kilo chat session worktrees\n.kilo/worktrees/\n`);
	}
}
