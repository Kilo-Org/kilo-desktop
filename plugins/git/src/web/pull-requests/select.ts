import type { WorkSession, Workspace } from "@kilo-desktop/plugin-work-sessions/contracts";

import type { PullRequest, PullRequestEntry } from "../../contracts";

/** Which branch a `git status` read found checked out, and when. */
export type CheckedOutBranch = { branch: string | undefined; observedAt: number };

/**
 * Where a work session's pull request is looked up: its copy (worktree), else
 * its workspace's primary folder. Work sessions outside a workspace have none.
 */
export function workSessionDirectory(
	workSession: Pick<WorkSession, "workspaceId" | "directory">,
	workspaces: readonly Workspace[],
): string | null {
	if (!workSession.workspaceId) return null;
	return (
		workSession.directory ??
		workspaces
			.find((workspace) => workspace.id === workSession.workspaceId)
			?.folders.find((folder) => folder.isPrimary)?.path ??
		null
	);
}

/**
 * A checked-out branch the last lookup has not seen: a status read newer than
 * that lookup names another branch. Detached HEADs (a rebase in progress)
 * never qualify, and neither does anything before the first lookup.
 */
export function branchAwaitingLookup(
	entry: PullRequestEntry | undefined,
	checkedOut?: CheckedOutBranch,
): string | null {
	if (!entry || !checkedOut?.branch || checkedOut.observedAt < entry.updatedAt) return null;
	return entry.snapshot.branch === checkedOut.branch ? null : checkedOut.branch;
}

/**
 * The pull request for a directory, shared by the header's repository
 * actions and the work session row and hover card so they always agree. The
 * newest observation of the checked-out branch wins: while a branch awaits
 * its lookup the PR is hidden (the header requests that lookup), and an older
 * status read (a background work session's cached status) cannot hide a fresher
 * lookup. The work session's stamped branch is never consulted; it goes
 * stale once the worktree checks out another branch, such as an existing
 * PR's head.
 */
export function visiblePullRequest(
	entry: PullRequestEntry | undefined,
	checkedOut?: CheckedOutBranch,
): PullRequest | null {
	if (branchAwaitingLookup(entry, checkedOut)) return null;
	return entry?.snapshot.pullRequest ?? null;
}
