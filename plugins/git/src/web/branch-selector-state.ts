import type { GitBranchesResult } from "../contracts/schemas.js";

export interface SelectorQueryState {
	readonly workspaceDirectory: string | undefined;
	readonly isChecking: boolean;
	readonly isRegular: boolean;
	readonly typeFailed: boolean;
	readonly branchesPending: boolean;
	readonly branchesFailed: boolean;
	readonly data: GitBranchesResult | null | undefined;
}

/**
 * Trigger label, mirroring the workspace selector's
 * `getWorkspaceTriggerLabel`: the branch name once loaded, a loading
 * label while probing, and the neutral "Select branch" otherwise. The
 * button is always rendered and always clickable — the state lives in
 * the label and the popover, never in the button's availability.
 */
export function getTriggerLabel(state: SelectorQueryState, pendingBranch?: string): string {
	if (pendingBranch !== undefined && pendingBranch !== (state.data?.currentBranch ?? undefined)) {
		return pendingBranch;
	}
	if (state.data) return state.data.currentBranch ?? "Detached HEAD";
	// Both probes resolved to a state without a branch list: the neutral
	// label, like the workspace trigger's "Select workspace" fallback.
	if (state.isChecking || (state.isRegular && state.branchesPending)) return "Loading…";
	return "Select branch";
}

/**
 * Inline popover message (the workspace picker's "Loading workspaces…" /
 * "No workspaces yet." pattern): `null` means the branch list should
 * render. Missing, bare, and unsafe (git's dubious-ownership protection)
 * workspaces get an explicit line here instead of a vanishing or dead
 * button — and their branch list is never fetched, so non-repo
 * workspaces stop spawning failing git probes.
 */
export function getPopoverMessage(state: SelectorQueryState): string | null {
	if (state.workspaceDirectory === undefined) return "No workspace selected.";
	if (state.isChecking) return "Loading…";
	if (state.typeFailed) return "Git is unavailable.";
	if (!state.isRegular) return "Not a git repository.";
	if (state.branchesPending) return "Loading…";
	if (state.branchesFailed || state.data === undefined || state.data === null) {
		return "Something went wrong!";
	}
	return null;
}
