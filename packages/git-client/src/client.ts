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
import type { IStatusResult, StatusOptions } from "./git/status.js";
import { getStatus } from "./git/status.js";

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
