import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type SymbolicRefExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

export interface SymbolicRefOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

export interface CheckRefFormatOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

/**
 * Check whether `name` is a valid branch name (`git check-ref-format --branch <name>`).
 * Returns `true` when git accepts it, `false` when it rejects it.
 * A leading-dash guard is the caller's responsibility (a leading dash would be
 * parsed as a flag even by this probe). Exit codes 0 (valid), 1 (invalid,
 * quiet mode), and 128 (invalid, fatal message for some names) are all expected
 * outcomes — only 0 means valid.
 */
export async function checkRefFormat(
	exec: SymbolicRefExec,
	name: string,
	options?: CheckRefFormatOptions,
): Promise<boolean> {
	const result = await exec(["check-ref-format", "--branch", name], "checkRefFormat", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
		successExitCodes: new Set([0, 1, 128]),
	});
	return result.exitCode === 0;
}

/**
 * Read a symbolic ref from the repository, e.g. `HEAD` → `refs/heads/main`.
 *
 * Resolves `null` when the ref cannot be found or is not a symbolic ref —
 * the git exit codes 1 (not a symref, quiet mode) and 128 (not found) are
 * expected outcomes, not errors.
 */
export async function getSymbolicRef(
	exec: SymbolicRefExec,
	ref: string,
	options?: SymbolicRefOptions,
): Promise<string | null> {
	const result = await exec(["symbolic-ref", "-q", ref], "getSymbolicRef", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
		successExitCodes: new Set([0, 1, 128]),
	});

	if (result.exitCode === 1 || result.exitCode === 128) {
		return null;
	}

	return result.stdout.trim();
}
