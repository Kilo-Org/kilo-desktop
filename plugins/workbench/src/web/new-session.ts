import type { DomainHandle } from "@kilo-desktop/kernel";
import type { Sessions } from "@kilo-desktop/plugin-sessions/contracts";
import type { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import type { Navigator } from "../contracts";

export interface NewSessionDomains {
	readonly sessions: DomainHandle<typeof Sessions> | null;
	readonly navigator: DomainHandle<typeof Navigator> | null;
	readonly workspaces: DomainHandle<typeof Workspaces> | null;
}

/**
 * "New session" opens the launcher. Like origin, it starts in the open
 * session's workspace, so ⌘N from a session keeps you in its project.
 */
export function startNewSession({ sessions, navigator, workspaces }: NewSessionDomains): void {
	if (!navigator) return;
	const activeId = navigator.getState().activeSessionId;
	const workspaceId = sessions
		?.getState()
		.sessions.find((session) => session.id === activeId)?.workspaceId;
	if (workspaceId) void workspaces?.methods.setActive({ id: workspaceId }).catch(() => undefined);
	void navigator.methods.close(undefined);
}
