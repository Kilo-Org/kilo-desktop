import type { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { buildEnv } from "./environment.js";
import { ExecError } from "./errors.js";
import { ignoreClosedInputStream } from "./ignore-closed-input-stream.js";

/**
 * The resolved execution context of a git client: which binary to invoke and
 * which client-level environment overrides apply to every invocation.
 */
export interface GitProcessContext {
	readonly gitLocation: string;
	readonly env: Record<string, string | undefined>;
}

export interface GitResult {
	/** The standard output from git. */
	readonly stdout: string | Buffer;

	/** The standard error output from git. */
	readonly stderr: string | Buffer;

	/** The exit code of the git process. */
	readonly exitCode: number;
}

/** The result of shelling out to git using a string encoding (default) */
export interface GitStringResult extends GitResult {
	/** The standard output from git. */
	readonly stdout: string;

	/** The standard error output from git. */
	readonly stderr: string;
}

/** The result of shelling out to git using a buffer encoding */
export interface GitBufferResult extends GitResult {
	/** The standard output from git. */
	readonly stdout: Buffer;

	/** The standard error output from git. */
	readonly stderr: Buffer;
}

/**
 * A set of configuration options that can be passed when
 * executing a git command.
 */
export interface GitExecutionOptions {
	/**
	 * An optional collection of key-value pairs which will be
	 * set as environment variables before executing the git
	 * process.
	 */
	readonly env?: Record<string, string | undefined>;

	/**
	 * An optional string or buffer which will be written to
	 * the child process stdin stream immediately
	 * after spawning the process.
	 */
	readonly stdin?: string | Buffer;

	/**
	 * The encoding to use when writing to stdin, if the stdin
	 * parameter is a string.
	 */
	readonly stdinEncoding?: BufferEncoding;

	/**
	 * The encoding to use when decoding the stdout and stderr output. Defaults to
	 * 'utf8'.
	 */
	readonly encoding?: BufferEncoding | "buffer";

	/**
	 * Largest amount of data in bytes allowed on stdout or stderr. If exceeded,
	 * the child process is terminated and any output is truncated.
	 *
	 * If not specified the default is Infinity, i.e. the only limit is the amount
	 * of allocatable memory on the system.
	 */
	readonly maxBuffer?: number;

	/**
	 * An optional callback which will be invoked with the child
	 * process instance after spawning the git process.
	 *
	 * Note that if the stdin parameter was specified the stdin
	 * stream will be closed by the time this callback fires.
	 */
	readonly processCallback?: (process: ChildProcess) => void;

	/**
	 * An abort signal which, when triggered, will cause a signal to be sent
	 * to the child process (determined by the killSignal option).
	 */
	readonly signal?: AbortSignal;

	/**
	 * The signal to send to the child process when calling kill
	 * without an explicit signal or when the process is killed due to the
	 * AbortSignal being triggered. Defaults to 'SIGTERM'
	 */
	readonly killSignal?: NodeJS.Signals;
}

export interface GitStringExecutionOptions extends GitExecutionOptions {
	readonly encoding?: BufferEncoding;
}

export interface GitBufferExecutionOptions extends GitExecutionOptions {
	readonly encoding: "buffer";
}

/**
 * Config overrides prepended to every invocation. A repository (or user)
 * `core.fsmonitor=true` makes any index-reading command start a long-lived
 * `git fsmonitor--daemon` per working tree; background probes across many
 * chat worktrees would leave one daemon running for each.
 */
const DEFAULT_CONFIG_ARGS = ["-c", "core.fsmonitor=false"] as const;

/** Prefix `args` with the client-wide config overrides. */
export function withDefaultConfig(args: readonly string[]): string[] {
	return [...DEFAULT_CONFIG_ARGS, ...args];
}

const ENOENT_MESSAGE =
	"ENOENT: Git failed to execute. This typically means that the path provided " +
	"doesn't exist or that the git executable could not be found at the resolved " +
	"path. Verify that the working directory exists, and that git is installed " +
	"or an explicit gitPath was passed to createGitClient().";

/**
 * Execute a git command and read its buffered output.
 *
 * The returned promise resolves with the git exit code and output (non-zero
 * exits resolve, they do not throw). It rejects with an `ExecError` when the
 * git executable fails to launch, in which case the error has a string `code`
 * property (e.g. ENOENT, ABORT_ERR, ERR_CHILD_PROCESS_STDIO_MAXBUFFER).
 *
 * Ported from dugite's exec: the transport is node's `execFile`, so libuv
 * fails the spawn of a missing binary with a genuine ENOENT on every
 * platform — unlike shell-mediated spawners, which on Windows turn a missing
 * binary into a cmd.exe exit code.
 */
export function exec(
	args: string[],
	path: string,
	context: GitProcessContext,
	options?: GitStringExecutionOptions,
): Promise<GitStringResult>;
export function exec(
	args: string[],
	path: string,
	context: GitProcessContext,
	options: GitBufferExecutionOptions,
): Promise<GitBufferResult>;
export function exec(
	args: string[],
	path: string,
	context: GitProcessContext,
	options?: GitExecutionOptions,
): Promise<GitResult>;
export function exec(
	args: string[],
	path: string,
	context: GitProcessContext,
	options?: GitExecutionOptions,
): Promise<GitResult> {
	const opts = {
		cwd: path,
		env: buildEnv(context.env, options?.env),
		// execFile never strips the trailing newline, which porcelain/patch
		// parsing depends on.
		encoding: options?.encoding ?? ("utf8" as const),
		maxBuffer: options?.maxBuffer ?? Number.POSITIVE_INFINITY,
		windowsHide: true,
		signal: options?.signal,
		killSignal: options?.killSignal,
	};

	return new Promise<GitResult>((resolve, reject) => {
		const argv = withDefaultConfig(args);
		const cp = execFile(context.gitLocation, argv, opts, (err, stdout, stderr) => {
			if (!err || typeof err.code === "number") {
				const exitCode = typeof err?.code === "number" ? err.code : 0;
				resolve({ stdout, stderr, exitCode });
				return;
			}

			// If the error's code is a string then it means the code isn't the
			// process's exit code but rather an error coming from Node's bowels,
			// e.g., ENOENT.
			let { message } = err;

			if (err.code === "ENOENT") {
				message = ENOENT_MESSAGE;
			}

			reject(new ExecError(message, stdout, stderr, err));
		});

		ignoreClosedInputStream(cp);

		if (options?.stdin !== undefined && cp.stdin) {
			// See https://github.com/nodejs/node/blob/7b5ffa46fe4d2868c1662694da06eb55ec744bde/test/parallel/test-stdin-pipe-large.js
			if (options.stdinEncoding) {
				cp.stdin.end(options.stdin, options.stdinEncoding);
			} else {
				cp.stdin.end(options.stdin);
			}
		}

		options?.processCallback?.(cp);
	});
}
