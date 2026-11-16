import type { IsolationOptions } from "../../../contracts";

export type IsolationBranch = IsolationOptions["branches"][number];

export interface BranchGroup {
	readonly identifier: "default" | "recent" | "local" | "remote";
	readonly heading: string;
	readonly items: readonly IsolationBranch[];
}

const REMOTE_REF_PREFIX = "refs/remotes/";

/** A remote branch's remote and branch path (`refs/remotes/origin/feat/x` → `origin`, `feat/x`). */
export function splitRemoteBranch(branch: Pick<IsolationBranch, "name" | "ref">): {
	readonly remote: string;
	readonly path: string;
} {
	const full = branch.ref.startsWith(REMOTE_REF_PREFIX)
		? branch.ref.slice(REMOTE_REF_PREFIX.length)
		: branch.name;
	const slash = full.indexOf("/");
	return slash === -1
		? { remote: full, path: full }
		: { remote: full.slice(0, slash), path: full.slice(slash + 1) };
}

/** A branch's label: remote-tracking refs drop the remote (`origin/feature` → `feature`). */
export function branchDisplayName(branch: Pick<IsolationBranch, "name" | "kind" | "ref">): string {
	return branch.kind === "remote" ? splitRemoteBranch(branch).path : branch.name;
}

/**
 * The default branch, recently checked-out branches, the other local
 * branches, then the remote-only branches. The service
 * already leaves out remote branches a local branch tracks, so a remote row
 * is never a second copy of a local one. Empty groups are left out, because
 * cmdk draws a heading even for an empty group.
 */
export function groupBranches(
	branches: readonly IsolationBranch[],
	defaultBranch: string | null,
	recentBranches: readonly string[],
): BranchGroup[] {
	const groups: BranchGroup[] = [];
	const defaultItem = branches.find((branch) => branch.name === defaultBranch);
	if (defaultItem) groups.push({ identifier: "default", heading: "Default", items: [defaultItem] });
	const recentNames = recentBranches.filter((name) => name !== defaultBranch);
	const recentItems = recentNames.flatMap((name) => {
		const branch = branches.find((candidate) => candidate.name === name);
		return branch ? [branch] : [];
	});
	if (recentItems.length > 0) {
		groups.push({ identifier: "recent", heading: "Recent", items: recentItems });
	}
	const recent = new Set(recentNames);
	const rest = branches.filter(
		(branch) => branch.name !== defaultBranch && !recent.has(branch.name),
	);
	const localItems = rest.filter((branch) => branch.kind === "local");
	if (localItems.length > 0)
		groups.push({ identifier: "local", heading: "Local", items: localItems });
	const remoteItems = rest.filter((branch) => branch.kind === "remote");
	if (remoteItems.length > 0) {
		groups.push({ identifier: "remote", heading: "Remote", items: remoteItems });
	}
	return groups;
}
