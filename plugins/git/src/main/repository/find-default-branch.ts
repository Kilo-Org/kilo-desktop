import type { GitBranch } from "../../contracts/models";

/**
 * Locate the default branch among the visible branches, the same way
 * GitHub Desktop does (`app/src/lib/find-default-branch.ts`, minus the
 * fork/upstream model): the remote HEAD name — or, when absent, the
 * `init.defaultBranch` global config, and finally the literal `main` —
 * decides which branch is the default; a local branch tracking
 * `origin/<remoteHead>` wins (preferring one also named like the
 * default), then a local branch named like the default, then the remote
 * branch itself. The remote is always `origin` here — this plugin has no
 * fork or multi-remote model, matching Desktop's `DefaultRemoteName`.
 *
 * Returns the branch's contract `name` (a remote hit is e.g.
 * `origin/main`), or `undefined` when nothing matches.
 */
export function findDefaultBranch(
	branches: ReadonlyArray<GitBranch>,
	remoteHead: string | null,
	configuredDefault: string | null,
): string | undefined {
	const defaultBranchName = remoteHead ?? configuredDefault ?? "main";
	const remoteRef = remoteHead !== null ? `origin/${remoteHead}` : undefined;

	let localHit: GitBranch | undefined;
	let localTrackingHit: GitBranch | undefined;
	let remoteHit: GitBranch | undefined;

	for (const branch of branches) {
		if (branch.kind === "local") {
			if (branch.name === defaultBranchName) {
				localHit = branch;
			}

			if (remoteRef !== undefined && branch.upstream === remoteRef) {
				// Give preference to local branches that target the remote
				// default branch that also match the name. In other words, if
				// there are two local branches which both track the origin
				// default branch we'll prefer a branch which is also named the
				// same as the default branch name.
				if (localTrackingHit === undefined || branch.name === defaultBranchName) {
					localTrackingHit = branch;
				}
			}
		} else if (remoteRef !== undefined && branch.name === remoteRef) {
			remoteHit = branch;
		}
	}

	// When determining what the default branch is we give priority to local
	// branches tracking the default branch of the remote (think origin), then
	// we consider local branches that are named the same as the default
	// branch, and finally we look for the remote branch representing the
	// default branch.
	return localTrackingHit?.name ?? localHit?.name ?? remoteHit?.name;
}
