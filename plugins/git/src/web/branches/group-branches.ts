import type { GitBranch } from "../../contracts/index.js";

export type BranchGroupIdentifier = "default" | "recent" | "other";

export interface BranchGroup {
	readonly identifier: BranchGroupIdentifier;
	/** Render-ready `CommandGroup` heading (title case, per the design mock). */
	readonly heading: "Default Branch" | "Recent Branches" | "Other Branches";
	readonly items: ReadonlyArray<GitBranch>;
}

/**
 * Group the flat branch list the way GitHub Desktop does
 * (`app/src/ui/branches/group-branches.ts`, minus its fork-remote
 * exclusion): the detected default branch (its full contract name, so a
 * remote-only hit groups under its `origin/...` name), the recently
 * checked-out local branches, and everything else — local and remote
 * intermingled. Empty groups are omitted because cmdk renders a heading
 * even for a group with no items.
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
		groups.push({
			identifier: "default",
			heading: "Default Branch",
			items: [defaultBranchItem],
		});
	}

	const recentBranchNames = new Set(recentBranches.filter((name) => name !== defaultBranch));
	const recentItems = recentBranches
		.filter((name) => name !== defaultBranch)
		.flatMap((name) => {
			// The service only reports names of existing local branches;
			// a miss still resolves to no item rather than a dangling name.
			const branch = allBranches.find((b) => b.name === name);
			return branch === undefined ? [] : [branch];
		});
	if (recentItems.length > 0) {
		groups.push({ identifier: "recent", heading: "Recent Branches", items: recentItems });
	}

	const otherItems = allBranches.filter(
		(b) => b.name !== defaultBranch && !recentBranchNames.has(b.name),
	);
	if (otherItems.length > 0) {
		groups.push({ identifier: "other", heading: "Other Branches", items: otherItems });
	}

	return groups;
}
