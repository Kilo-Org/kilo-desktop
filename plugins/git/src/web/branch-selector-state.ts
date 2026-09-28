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
 * A regular git repository whose HEAD points to a named branch that has no
 * commits yet (`git init` with no commits). `git for-each-ref` returns nothing
 * in this state, so `data.branches` is empty, but `data.currentBranch` is set.
 * Branch creation and checkout both fail until at least one commit exists.
 */
export function isUnbornRepository(data: GitBranchesResult | null | undefined): boolean {
	return (
		data !== null &&
		data !== undefined &&
		data.branches.length === 0 &&
		data.currentBranch !== undefined
	);
}

/**
 * Whether the trigger shows its loading state — exactly when
 * `getTriggerLabel` returns "Loading…": no branch list yet, no
 * pending-branch override, and a probe still in flight. Callers swap
 * the trigger's icon for a spinner and mute the label with this.
 */
export function isTriggerLoading(state: SelectorQueryState, pendingBranch?: string): boolean {
	// With no list, any pending branch differs from the (absent) current
	// one, so it overrides the label instead of the loading state.
	if (pendingBranch !== undefined) return false;
	if (state.data) return false;
	return state.isChecking || (state.isRegular && state.branchesPending);
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
	if (isTriggerLoading(state)) return "Loading…";
	return "Select branch";
}

/** Current branch for a read-only label. Hidden until a name is known. */
export function getReadOnlyBranchLabel(state: SelectorQueryState): string | undefined {
	if (!state.data) return undefined;
	return state.data.currentBranch ?? "Detached HEAD";
}

/**
 * Structured unborn-repository notice. The component renders this with a
 * bold heading and two descriptive lines rather than the plain-string path.
 */
export interface UnbornNotice {
	readonly kind: "unborn";
}

/**
 * Structured loading notice. The component renders this with a spinner
 * in front of the "Loading…" line rather than the plain-string path.
 */
export interface LoadingNotice {
	readonly kind: "loading";
}

/**
 * Inline popover message (the workspace picker's "Loading workspaces…" /
 * "No workspaces yet." pattern): `null` means the branch list should
 * render. Missing, bare, and unsafe (git's dubious-ownership protection)
 * workspaces get an explicit line here instead of a vanishing or dead
 * button — and their branch list is never fetched, so non-repo
 * workspaces stop spawning failing git probes.
 *
 * Unborn repositories (no commits yet) return an `UnbornNotice` and
 * in-flight probes return a `LoadingNotice` so the component can render
 * structured content (heading + body, spinner + line) rather than a
 * single-line string.
 */
export function getPopoverMessage(
	state: SelectorQueryState,
): string | UnbornNotice | LoadingNotice | null {
	if (state.workspaceDirectory === undefined) return "No workspace selected.";
	if (state.isChecking) return { kind: "loading" };
	if (state.typeFailed) return "Git is unavailable.";
	if (!state.isRegular) return "Not a git repository.";
	if (state.branchesPending) return { kind: "loading" };
	if (state.branchesFailed || state.data === undefined || state.data === null) {
		return "Something went wrong!";
	}
	if (isUnbornRepository(state.data)) {
		return { kind: "unborn" };
	}
	return null;
}
