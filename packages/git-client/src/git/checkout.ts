import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type CheckoutExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

export interface CheckoutOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
	/**
	 * Create a local branch that tracks `branchName` (`git checkout --track`).
	 * Used when `branchName` is a remote-tracking ref such as `origin/feature`.
	 */
	readonly track?: boolean;
}

/**
 * Check out the given branch. With `track`, create a local branch that
 * follows the named remote-tracking ref (`git checkout --track`).
 *
 * Unexpected git failures (missing branch, conflicting dirty tree, invalid
 * name, …) throw `GitError`; callers inspect the parsed code with `isGitError`.
 */
export async function checkoutBranch(
	exec: CheckoutExec,
	branchName: string,
	options?: CheckoutOptions,
): Promise<void> {
	const args = options?.track
		? ["checkout", "--track", branchName, "--"]
		: ["checkout", branchName, "--"];
	await exec(args, "checkoutBranch", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});
}
