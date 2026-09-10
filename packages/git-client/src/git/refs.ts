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
