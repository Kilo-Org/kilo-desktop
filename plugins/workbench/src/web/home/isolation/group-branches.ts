import type { IsolationOptions } from "@kilo-desktop/plugin-sessions/contracts";

export type IsolationBranch = IsolationOptions["branches"][number];

export interface BranchGroup {
	readonly identifier: "default" | "recent" | "other";
	readonly heading: "Default Branch" | "Recent Branches" | "Other Branches";
	readonly items: readonly IsolationBranch[];
}

const REMOTE_REF_PREFIX = "refs/remotes/";

/** A branch's label: remote-tracking refs drop the remote (`origin/feature` → `feature`). */
export function branchDisplayName(branch: Pick<IsolationBranch, "name" | "kind" | "ref">): string {
	if (branch.kind !== "remote" || !branch.ref.startsWith(REMOTE_REF_PREFIX)) return branch.name;
	const afterRemote = branch.ref.slice(REMOTE_REF_PREFIX.length);
	const slash = afterRemote.indexOf("/");
	return slash === -1 ? afterRemote : afterRemote.slice(slash + 1);
}

/**
 * Origin's (GitHub Desktop's) grouping: the default branch, recently
 * checked-out branches, then everything else. Empty groups are left out,
 * because cmdk draws a heading even for an empty group.
 */
export function groupBranches(
	branches: readonly IsolationBranch[],
	defaultBranch: string | null,
	recentBranches: readonly string[],
): BranchGroup[] {
	const groups: BranchGroup[] = [];
	const defaultItem = branches.find((branch) => branch.name === defaultBranch);
	if (defaultItem)
		groups.push({ identifier: "default", heading: "Default Branch", items: [defaultItem] });
	const recentNames = recentBranches.filter((name) => name !== defaultBranch);
	const recentItems = recentNames.flatMap((name) => {
		const branch = branches.find((candidate) => candidate.name === name);
		return branch ? [branch] : [];
	});
	if (recentItems.length > 0) {
		groups.push({ identifier: "recent", heading: "Recent Branches", items: recentItems });
	}
	const recent = new Set(recentNames);
	const otherItems = branches.filter(
		(branch) => branch.name !== defaultBranch && !recent.has(branch.name),
	);
	if (otherItems.length > 0) {
		groups.push({ identifier: "other", heading: "Other Branches", items: otherItems });
	}
	return groups;
}
