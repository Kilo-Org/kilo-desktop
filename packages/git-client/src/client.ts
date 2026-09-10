import process from "node:process";

import type {
	IGitBufferExecutionOptions,
	IGitBufferResult,
	IGitExecutionOptions,
	IGitResult,
	IGitStringExecutionOptions,
	IGitStringResult,
} from "./git/core.js";
import { git } from "./git/core.js";
import { exec as execGit } from "./exec/exec.js";
import type { GitProcessContext } from "./exec/exec.js";
import { buildEnv } from "./exec/environment.js";
import { createGitLogger } from "./logger.js";
import type { GitLogger } from "./logger.js";
import { resolveGitBinary } from "./exec/resolve-git.js";
import { parseGitVersion, satisfies as satisfiesRange } from "./exec/version.js";
import type { BranchOptions } from "./git/branch.js";
import { createBranch } from "./git/branch.js";
import type { CheckoutOptions } from "./git/checkout.js";
import { checkoutBranch } from "./git/checkout.js";
import type { ForEachRefOptions } from "./git/for-each-ref.js";
import type { IBranch } from "./models/branch.js";
import { getBranches } from "./git/for-each-ref.js";
import type { RepositoryType } from "./git/rev-parse.js";
import { getRepositoryType } from "./git/rev-parse.js";
import type { IStatusResult, StatusOptions } from "./git/status.js";
import { getStatus } from "./git/status.js";
import type { CreateWorkingDirectoryPatchOptions, GitPatchFile, PatchExec } from "./git/diff.js";
import { createWorkingDirectoryPatch } from "./git/diff.js";
import type { GetFileContentsOptions, WorkingTreeFileContents } from "./git/file-contents.js";
import { getFileContents } from "./git/file-contents.js";
import { getGlobalConfigValue } from "./git/config.js";
import type { RecentBranchesOptions } from "./git/reflog.js";
import { getRecentBranches } from "./git/reflog.js";
import type { RemoteHeadOptions } from "./git/remote.js";
import { getRemoteHEAD } from "./git/remote.js";
import type { SymbolicRefOptions } from "./git/refs.js";
import { getSymbolicRef } from "./git/refs.js";
import type { ShowExec } from "./git/show.js";

export interface GitClientOptions {
	/** Working directory for git commands. Defaults to process.cwd(). */
	readonly path?: string;
	/** Explicit git binary path. Defaults to `which('git')` resolution. */
	readonly gitPath?: string;
	/** Base env overrides applied to every invocation (per-call options.env wins). */
	readonly env?: Record<string, string | undefined>;
	/** Logger sink for unexpected git failures. Defaults to `console.error`. */
	readonly logger?: GitLogger;
}

export interface GitClient {
	/** Default working directory for all invocations. */
	readonly path: string;
	/**
	 * Execute a git command with desktop `git()` semantics: unexpected exit
	 * codes and unexpected parsed errors throw `GitError`.
	 *
	 * @param args    Full argument vector after `git` (leading `-c`/`-C`
	 *                global args work naturally).
	 * @param name    Name of the command for diagnostics (used in error
	 *                messages and log lines).
	 * @param options `cwd` overrides the working directory for this call;
	 *                it defaults to the client's `path`.
	 */
	exec(
		args: string[],
		name: string,
		options?: IGitStringExecutionOptions,
	): Promise<IGitStringResult>;
	exec(
		args: string[],
		name: string,
		options: IGitBufferExecutionOptions,
	): Promise<IGitBufferResult>;
	/** Memoized. Coerced semver string, e.g. "2.39.5". */
	version(): Promise<string>;
	/** Memoized version checked against a semver range, e.g. satisfies(">=2.23"). */
	satisfies(range: string): Promise<boolean>;
	/**
	 * Status of the bound repository's working directory and branch.
	 * Resolves `null` when the working directory is not inside a git
	 * repository (git status exit code 128). `options.cwd` overrides the
	 * working directory for this call; it defaults to the client's `path`.
	 */
	status(options?: StatusOptions): Promise<IStatusResult | null>;
	/**
	 * Write the complete working-tree patch (staged + unstaged + untracked
	 * vs `commitish`, default `HEAD`) to a temp file WITHOUT touching the
	 * user's real index (throwaway `GIT_INDEX_FILE`). Resolves `null` when
	 * the working directory is not inside a git repository; an empty working
	 * tree yields a zero-byte patch. The caller must `cleanup()` the result.
	 */
	createWorkingDirectoryPatch(
		options?: CreateWorkingDirectoryPatchOptions,
	): Promise<GitPatchFile | null>;
	/**
	 * Both sides of a working-tree file's contents (old side from
	 * `commitish`, default `HEAD`, new side from disk), for diff hunk
	 * expansion. Null sides mean that side is absent (new/untracked file,
	 * deleted file, unborn HEAD). `options.cwd` overrides the working
	 * directory for this call; it defaults to the client's `path`.
	 */
	getFileContents(options: GetFileContentsOptions): Promise<WorkingTreeFileContents>;
	/**
	 * Local branches (refs/heads) of the repository, via `git for-each-ref`.
	 * Resolves `null` when the working directory is not inside a git
	 * repository. `options.cwd` overrides the working directory for this
	 * call; it defaults to the client's `path`.
	 */
	branches(options?: ForEachRefOptions): Promise<IBranch[] | null>;
	/**
	 * Create a branch at `startPoint` (or the current HEAD when omitted)
	 * with `git branch <name> [startPoint]`. `options.cwd` overrides the
	 * working directory for this call; it defaults to the client's `path`.
	 */
	createBranch(name: string, startPoint?: string, options?: BranchOptions): Promise<void>;
	/**
	 * Check out the given branch with `git checkout <branch> --`.
	 * `options.track` creates a local branch that follows a remote-tracking
	 * ref (`git checkout --track`). Unexpected git failures throw
	 * `GitError` (inspect with `isGitError`). `options.cwd` overrides the
	 * working directory for this call; it defaults to the client's `path`.
	 */
	checkoutBranch(branch: string, options?: CheckoutOptions): Promise<void>;
	/**
	 * The repository type of the given path (`missing`, `unsafe`, `bare`,
	 * or `regular` with the top-level working directory and git dir),
	 * determined by a single `git rev-parse` probe. Defaults to the
	 * client's `path`.
	 */
	repositoryType(path?: string): Promise<RepositoryType>;
	/**
	 * Read a symbolic ref (e.g. `HEAD` → `refs/heads/main`). Resolves
	 * `null` when the ref cannot be found or is not a symbolic ref.
	 * `options.cwd` overrides the working directory for this call; it
	 * defaults to the client's `path`.
	 */
	symbolicRef(ref: string, options?: SymbolicRefOptions): Promise<string | null>;
	/**
	 * The default branch of a remote, from the remote's `HEAD` symbolic
	 * ref (`refs/remotes/&lt;remote&gt;/HEAD`), without the remote
	 * namespace. Resolves `null` when the symref is absent or points
	 * outside the namespace. `options.cwd` overrides the working
	 * directory for this call; it defaults to the client's `path`.
	 */
	remoteHead(remote: string, options?: RemoteHeadOptions): Promise<string | null>;
	/**
	 * A global config value by name. Resolves `null` when the value is
	 * not configured. Reads the global config regardless of the working
	 * directory.
	 */
	globalConfigValue(name: string): Promise<string | null>;
	/**
	 * The `limit` most recently checked out branches from the HEAD
	 * reflog, newest first. Resolves an empty list for an unborn
	 * branch. `options.cwd` overrides the working directory for this
	 * call; it defaults to the client's `path`.
	 */
	recentBranches(limit: number, options?: RecentBranchesOptions): Promise<string[]>;
}

/**
 * One resolved git binary + client env, reused by every invocation of a client.
 * Binary resolution is sync (`which.sync`) and memoized because
 * `LOCAL_GIT_DIRECTORY`/`PATH` only influence the first resolution — later
 * changes to the process environment deliberately do not re-resolve.
 */
class GitClientImpl implements GitClient {
	readonly path: string;

	readonly #gitPath: string | undefined;
	readonly #clientEnv: Record<string, string | undefined>;
	readonly #injectedLogger: GitLogger | undefined;
	#context: GitProcessContext | undefined;
	#logger: GitLogger | undefined;
	#version: Promise<string> | undefined;

	constructor(options: GitClientOptions = {}) {
		this.path = options.path ?? process.cwd();
		this.#gitPath = options.gitPath;
		this.#clientEnv = options.env ?? {};
		this.#injectedLogger = options.logger;
	}

	exec(
		args: string[],
		name: string,
		options?: IGitStringExecutionOptions,
	): Promise<IGitStringResult>;
	exec(
		args: string[],
		name: string,
		options: IGitBufferExecutionOptions,
	): Promise<IGitBufferResult>;
	async exec(args: string[], name: string, options?: IGitExecutionOptions): Promise<IGitResult> {
		const { cwd, ...rest } = options ?? {};
		return git(args, cwd ?? this.path, name, this.#resolveContext(), this.#resolveLogger(), rest);
	}

	version(): Promise<string> {
		this.#version ??= execGit(["--version"], this.path, this.#resolveContext()).then((result) =>
			parseGitVersion(result.stdout),
		);
		return this.#version;
	}

	async satisfies(range: string): Promise<boolean> {
		return satisfiesRange(await this.version(), range);
	}

	status(options?: StatusOptions): Promise<IStatusResult | null> {
		return getStatus(
			(args, name, opts) =>
				this.exec(args, name, options?.cwd ? { ...opts, cwd: options.cwd } : opts),
			options,
		);
	}

	createWorkingDirectoryPatch(
		options?: CreateWorkingDirectoryPatchOptions,
	): Promise<GitPatchFile | null> {
		const exec: PatchExec = (args, name, opts) =>
			this.exec(args, name, options?.cwd ? { ...opts, cwd: options.cwd } : opts);
		return createWorkingDirectoryPatch(exec, options);
	}

	getFileContents(options: GetFileContentsOptions): Promise<WorkingTreeFileContents> {
		const cwd = options.cwd ?? this.path;
		const exec: ShowExec = (args, name, opts) => this.exec(args, name, { ...opts, cwd });
		return getFileContents(exec, { ...options, cwd });
	}

	branches(options?: ForEachRefOptions): Promise<IBranch[] | null> {
		return getBranches(
			(args, name, opts) =>
				this.exec(args, name, options?.cwd ? { ...opts, cwd: options.cwd } : opts),
			options,
		);
	}

	createBranch(name: string, startPoint?: string, options?: BranchOptions): Promise<void> {
		return createBranch(
			(args, execName, opts) =>
				this.exec(args, execName, options?.cwd ? { ...opts, cwd: options.cwd } : opts),
			name,
			startPoint,
		);
	}

	checkoutBranch(branch: string, options?: CheckoutOptions): Promise<void> {
		return checkoutBranch(
			(args, name, opts) =>
				this.exec(args, name, options?.cwd ? { ...opts, cwd: options.cwd } : opts),
			branch,
			options,
		);
	}

	/**
	 * The module sets `cwd: path` itself — the probed path is the cwd — so
	 * the executor is the client's `exec` unmodified (identity).
	 */
	repositoryType(path?: string): Promise<RepositoryType> {
		return getRepositoryType((args, name, opts) => this.exec(args, name, opts), path ?? this.path);
	}

	symbolicRef(ref: string, options?: SymbolicRefOptions): Promise<string | null> {
		return getSymbolicRef(this.#exec, ref, options);
	}

	remoteHead(remote: string, options?: RemoteHeadOptions): Promise<string | null> {
		return getRemoteHEAD(this.#exec, remote, options);
	}

	globalConfigValue(name: string): Promise<string | null> {
		return getGlobalConfigValue(this.#exec, name);
	}

	recentBranches(limit: number, options?: RecentBranchesOptions): Promise<string[]> {
		return getRecentBranches(this.#exec, limit, options);
	}

	/** The bound exec with no cwd override — the probe modules set `cwd` from their options. */
	get #exec() {
		return (args: string[], name: string, opts: IGitStringExecutionOptions) =>
			this.exec(args, name, opts);
	}

	#resolveContext(): GitProcessContext {
		this.#context ??= {
			gitLocation: resolveGitBinary(this.#gitPath, buildEnv(this.#clientEnv)),
			env: this.#clientEnv,
		};
		return this.#context;
	}

	#resolveLogger(): GitLogger {
		this.#logger ??= this.#injectedLogger ?? createGitLogger();
		return this.#logger;
	}
}

/**
 * Create a git client bound to a working directory.
 *
 * The client resolves the git binary lazily on first use: an explicit
 * `gitPath`, then the `LOCAL_GIT_DIRECTORY` environment variable, then
 * `which("git")`. A resolution failure throws
 * `GitNotDetectedError` — as a rejection from `exec()`/`version()`/`satisfies()`.
 */
export function createGitClient(options?: GitClientOptions): GitClient {
	return new GitClientImpl(options);
}
