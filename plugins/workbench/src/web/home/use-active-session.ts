import { useCallback } from "react";

import { useDomainState } from "@kilo-desktop/kernel/web";
import { Sessions, type Session } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces, type Workspace } from "@kilo-desktop/plugin-workspaces/contracts";

import { Navigator, type NavigatorState } from "../../contracts";

const selectActiveId = (state: NavigatorState) => state.activeSessionId;

/** The session open in this window, or null on the launcher. */
export function useActiveSession(): Session | null {
	const activeId = useDomainState(Navigator, selectActiveId) ?? null;
	const select = useCallback(
		(state: { sessions: readonly Session[] }) =>
			activeId === null
				? null
				: (state.sessions.find((session) => session.id === activeId) ?? null),
		[activeId],
	);
	return useDomainState(Sessions, select) ?? null;
}

/** The workspace a session belongs to, when it still exists. */
export function useSessionWorkspace(session: Session | null): Workspace | null {
	const workspaceId = session?.workspaceId ?? null;
	const select = useCallback(
		(state: { workspaces: readonly Workspace[] }) =>
			workspaceId === null
				? null
				: (state.workspaces.find((workspace) => workspace.id === workspaceId) ?? null),
		[workspaceId],
	);
	return useDomainState(Workspaces, select) ?? null;
}
