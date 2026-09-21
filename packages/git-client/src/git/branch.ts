import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type BranchExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

export interface BranchOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

/**
 * Create a new branch from the given start point.
 *
 * @param name       The name of the new branch
 * @param startPoint A committish string the new branch should be based on,
 *                   or `undefined` to base it on the current state of HEAD
 */
export async function createBranch(
	exec: BranchExec,
	name: string,
	startPoint?: string,
	options?: BranchOptions,
): Promise<void> {
	const args = startPoint !== undefined ? ["branch", name, startPoint] : ["branch", name];

	await exec(args, "createBranch", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});
}

/**
 * Delete the given local branch, discarding unmerged work
 * (`git branch -D`).
 */
export async function deleteBranch(
	exec: BranchExec,
	name: string,
	options?: BranchOptions,
): Promise<void> {
	await exec(["branch", "-D", name], "deleteBranch", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});
}

/** Rename the given local branch to `next` (`git branch -m`). */
export async function renameBranch(
	exec: BranchExec,
	name: string,
	next: string,
	options?: BranchOptions,
): Promise<void> {
	await exec(["branch", "-m", name, next], "renameBranch", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});
}
