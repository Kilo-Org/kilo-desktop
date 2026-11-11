import type { DomainObjectHandle } from "@kilo-desktop/kernel";

import type { WorkSessions, WorkSessionsWindow, Workspaces } from "../../contracts";
import { matchesWorkspaceFocus } from "../shared/workspace-focus";

export interface NewWorkSessionDomains {
	readonly workSessions: DomainObjectHandle<typeof WorkSessions> | null;
	readonly window: DomainObjectHandle<typeof WorkSessionsWindow> | null;
	readonly workspaces: DomainObjectHandle<typeof Workspaces> | null;
}

/**
 * "New session" opens the New Session page. Like origin, it starts in the
 * open work session's workspace, so ⌘N from a session keeps you in its project —
 * unless the workspace switcher has since moved to another workspace: picking
 * one there already made it active, and that later choice wins.
 */
export function startNewWorkSession({
	workSessions,
	window,
	workspaces,
}: NewWorkSessionDomains): void {
	if (!window) return;
	const { activeWorkSessionId, focus } = window.getState();
	const workspaceId = workSessions
		?.getState()
		.workSessions.find((workSession) => workSession.id === activeWorkSessionId)?.workspaceId;
	if (workspaceId && matchesWorkspaceFocus(workspaceId, focus)) {
		void workspaces?.methods.setActive({ id: workspaceId }).catch(() => undefined);
	}
	void window.methods.closeWorkSession(undefined);
}
