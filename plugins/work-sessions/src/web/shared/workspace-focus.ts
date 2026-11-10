import { UNSCOPED_WORKSPACE_FOCUS } from "../../contracts";

/** True when a work session in `workspaceId` (none: unscoped) shows under the list's `focus`. */
export function matchesWorkspaceFocus(
	workspaceId: string | null | undefined,
	focus: string | null,
): boolean {
	if (focus === null) return true;
	if (focus === UNSCOPED_WORKSPACE_FOCUS) return !workspaceId;
	return workspaceId === focus;
}

/** The focus, or null when there is none or its workspace no longer exists. */
export function resolveWorkspaceFocus(
	focus: string | null,
	workspaces: readonly { id: string }[],
): string | null {
	if (focus === UNSCOPED_WORKSPACE_FOCUS) return focus;
	return focus && workspaces.some((workspace) => workspace.id === focus) ? focus : null;
}
