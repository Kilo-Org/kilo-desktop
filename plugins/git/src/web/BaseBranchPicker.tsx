import { GitForkIcon } from "lucide-react";

import type { GitBranch } from "../contracts/schemas.js";
import { BranchPickerPopover } from "./BranchPickerPopover.js";

/**
 * Base-branch picker for worktree mode: the shared `BranchPickerPopover`
 * parameterized for base-picking — grouped, searchable, and visually
 * identical to the local branch selector, but pure: selecting a branch
 * only records it as the worktree's base (the full contract name, a
 * valid `worktree add` commitish). No create flow (the base branch
 * already exists by definition) and no note states (worktree mode is
 * only reachable for a probed regular repository).
 */
export function BaseBranchPicker({
	selectedBase,
	defaultBase,
	branches,
	defaultBranch,
	recentBranches,
	onSelect,
}: {
	selectedBase: string | undefined;
	defaultBase: string | null | undefined;
	branches: ReadonlyArray<GitBranch>;
	defaultBranch: string | undefined;
	recentBranches: ReadonlyArray<string>;
	onSelect: (baseBranch: string | undefined) => void;
}) {
	const effectiveBase = selectedBase ?? defaultBase ?? undefined;
	const loading = effectiveBase === undefined && defaultBase === undefined;
	const label =
		effectiveBase === undefined
			? defaultBase === null
				? "From current branch"
				: "Loading…"
			: `From ${effectiveBase}`;

	return (
		<BranchPickerPopover
			triggerIcon={<GitForkIcon data-icon="inline-start" />}
			triggerLabel={label}
			triggerLoading={loading}
			triggerTestId="git-base-branch-trigger"
			branches={branches}
			defaultBranch={defaultBranch}
			recentBranches={recentBranches}
			checkedBranch={effectiveBase}
			itemTestIdPrefix="git-base-branch-item-"
			onSelect={(branch) => onSelect(branch.name)}
		/>
	);
}
