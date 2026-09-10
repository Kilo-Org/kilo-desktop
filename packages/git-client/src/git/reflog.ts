import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type RecentBranchesExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

export interface RecentBranchesOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

/** Matches `checkout` and `Branch: renamed` reflog entries (ported verbatim from GitHub Desktop). */
const checkoutOrRenameRe =
	/.*? (renamed|checkout)(?:: moving from|\s*) (?:refs\/heads\/|\s*)(.*?) to (?:refs\/heads\/|\s*)(.*?)$/i;

/**
 * Get the `limit` most recently checked out branches from the HEAD reflog.
 *
 * Resolves an empty list for an unborn branch — git's exit code 128 is an
 * expected outcome, not an error. Branch renames exclude the intermediate
 * rename-source name so it never surfaces as a recent branch.
 */
export async function getRecentBranches(
	exec: RecentBranchesExec,
	limit: number,
	options?: RecentBranchesOptions,
): Promise<string[]> {
	// "git reflog show" is just an alias for "git log -g --abbrev-commit --pretty=oneline"
	// but by using log we can give it a max number which should prevent us from balling out
	// of control when there's ginormous reflogs around (as in e.g. github/github).
	const result = await exec(
		["log", "-g", "--no-abbrev-commit", "--pretty=oneline", "HEAD", "-n", "2500", "--"],
		"getRecentBranches",
		{
			...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
			successExitCodes: new Set([0, 128]),
		},
	);

	if (result.exitCode === 128) {
		// error code 128 is returned if the branch is unborn
		return [];
	}

	const lines = result.stdout.split("\n");
	const names = new Set<string>();
	const excludedNames = new Set<string>();

	for (const line of lines) {
		const match = checkoutOrRenameRe.exec(line);
		if (match && match.length === 4) {
			const [, operationType = "", excludeBranchName = "", branchName = ""] = match;

			if (operationType === "renamed") {
				// exclude intermediate-state renaming branch from recent branches
				excludedNames.add(excludeBranchName);
			}

			if (!excludedNames.has(branchName)) {
				names.add(branchName);
			}
		}

		if (names.size === limit) {
			break;
		}
	}

	return [...names];
}
