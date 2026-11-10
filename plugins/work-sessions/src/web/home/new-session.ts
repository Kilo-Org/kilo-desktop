import type { DomainObjectHandle } from "@kilo-desktop/kernel";

import type { WorkSessions, WorkSessionsWindow, Workspaces } from "../../contracts";

export interface NewWorkSessionDomains {
	readonly workSessions: DomainObjectHandle<typeof WorkSessions> | null;
	readonly window: DomainObjectHandle<typeof WorkSessionsWindow> | null;
	readonly workspaces: DomainObjectHandle<typeof Workspaces> | null;
}

/**
 * "New session" opens the New Session page. Like origin, it starts in the
 * open work session's workspace, so ⌘N from a session keeps you in its project.
 */
export function startNewWorkSession({
	workSessions,
	window,
	workspaces,
}: NewWorkSessionDomains): void {
	if (!window) return;
	const activeId = window.getState().activeWorkSessionId;
	const workspaceId = workSessions
		?.getState()
		.workSessions.find((workSession) => workSession.id === activeId)?.workspaceId;
	if (workspaceId) void workspaces?.methods.setActive({ id: workspaceId }).catch(() => undefined);
	void window.methods.closeWorkSession(undefined);
}
