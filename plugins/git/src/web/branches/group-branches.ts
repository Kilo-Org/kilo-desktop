import type { GitBranch } from "../../contracts";

export interface BranchGroup {
	readonly identifier: "default" | "recent" | "local" | "remote";
	/** Render-ready `CommandGroup` heading. */
	readonly heading: string;
	readonly items: ReadonlyArray<GitBranch>;
}

/**
 * Group the flat branch list: the detected default branch (its full
 * contract name, so a remote-only hit groups under its `origin/...` name),
 * the recently checked-out local branches, the other local branches, then
 * the remote-only branches (the service already leaves
 * out remote branches a local branch tracks). Empty groups are omitted
 * because cmdk renders a heading even for a group with no items.
 */
export function groupBranches(
	allBranches: ReadonlyArray<GitBranch>,
	defaultBranch: string | undefined,
	recentBranches: ReadonlyArray<string>,
): ReadonlyArray<BranchGroup> {
	const groups = new Array<BranchGroup>();

	const defaultBranchItem =
		defaultBranch === undefined ? undefined : allBranches.find((b) => b.name === defaultBranch);
	if (defaultBranchItem !== undefined) {
		groups.push({ identifier: "default", heading: "Default", items: [defaultBranchItem] });
	}

	const recentBranchNames = new Set(recentBranches.filter((name) => name !== defaultBranch));
	const recentItems = [...recentBranchNames].flatMap((name) => {
		// The service only reports names of existing local branches;
		// a miss still resolves to no item rather than a dangling name.
		const branch = allBranches.find((b) => b.name === name);
		return branch === undefined ? [] : [branch];
	});
	if (recentItems.length > 0) {
		groups.push({ identifier: "recent", heading: "Recent", items: recentItems });
	}

	const rest = allBranches.filter(
		(b) => b.name !== defaultBranch && !recentBranchNames.has(b.name),
	);
	const localItems = rest.filter((b) => b.kind === "local");
	if (localItems.length > 0) {
		groups.push({ identifier: "local", heading: "Local", items: localItems });
	}
	const remoteItems = rest.filter((b) => b.kind === "remote");
	if (remoteItems.length > 0) {
		groups.push({ identifier: "remote", heading: "Remote", items: remoteItems });
	}

	return groups;
}
