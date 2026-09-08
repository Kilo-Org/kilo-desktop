import { spawn as _spawn } from "node:child_process";

import { buildEnv } from "./environment.js";
import type { GitProcessContext } from "./exec.js";
import { ignoreClosedInputStream } from "./ignore-closed-input-stream.js";

/**
 * A set of configuration options that can be passed when
 * executing a streaming git command.
 */
export interface GitSpawnOptions {
	/**
	 * An optional collection of key-value pairs which will be
	 * set as environment variables before executing the git
	 * process.
	 */
	readonly env?: Record<string, string | undefined>;
}

/**
 * Execute a command and interact with the process outputs directly.
 *
 * The subprocess streams its stdout/stderr as it runs; consumers observe the
 * exit code and any spawn failure through the process's 'exit' and 'error'
 * events. A spawn failure surfaces as an 'error' event whose Error has a
 * string `code` property (e.g. ENOENT).
 *
 * Ported from dugite's spawn.
 */
export function spawn(
	args: string[],
	path: string,
	context: GitProcessContext,
	opts?: GitSpawnOptions,
) {
	const spawnedProcess = _spawn(context.gitLocation, args, {
		cwd: path,
		env: buildEnv(context.env, opts?.env),
		windowsHide: true,
	});

	ignoreClosedInputStream(spawnedProcess);

	return spawnedProcess;
}
