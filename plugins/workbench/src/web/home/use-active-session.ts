import { useCallback } from "react";

import { useDomainState } from "@kilo-desktop/kernel/web";
import { WorkSessions, type WorkSession } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces, type Workspace } from "@kilo-desktop/plugin-workspaces/contracts";

import { Workbench, type WorkbenchState } from "../../contracts";

const selectActiveId = (state: WorkbenchState) => state.activeSessionId;

/** The session open in this window, or null on the launcher. */
export function useActiveSession(): WorkSession | null {
	const activeId = useDomainState(Workbench, selectActiveId) ?? null;
	const select = useCallback(
		(state: { sessions: readonly WorkSession[] }) =>
			activeId === null
				? null
				: (state.sessions.find((session) => session.id === activeId) ?? null),
		[activeId],
	);
	return useDomainState(WorkSessions, select) ?? null;
}

/** The workspace a session belongs to, when it still exists. */
export function useSessionWorkspace(session: WorkSession | null): Workspace | null {
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
