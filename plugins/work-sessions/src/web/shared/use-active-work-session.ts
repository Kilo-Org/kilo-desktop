import { useCallback } from "react";

import { useDomainObjectState } from "@kilo-desktop/kernel/web";

import {
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type WorkSession,
	type WorkSessionsState,
	type WorkSessionsWindowState,
	type Workspace,
	type WorkspacesState,
} from "../../contracts";

const selectActiveId = (state: WorkSessionsWindowState) => state.activeWorkSessionId;

/** The work session open in this window, or null on the New Session page. */
export function useActiveWorkSession(): WorkSession | null {
	const activeId = useDomainObjectState(WorkSessionsWindow, selectActiveId) ?? null;
	return useWorkSession(activeId);
}

/** A work session by id, while it exists. */
export function useWorkSession(workSessionId: string | null): WorkSession | null {
	const select = useCallback(
		(state: WorkSessionsState) =>
			workSessionId === null
				? null
				: (state.workSessions.find((workSession) => workSession.id === workSessionId) ?? null),
		[workSessionId],
	);
	return useDomainObjectState(WorkSessions, select) ?? null;
}

/** The workspace a work session belongs to, when it still exists. */
export function useWorkSessionWorkspace(workSession: WorkSession | null): Workspace | null {
	const workspaceId = workSession?.workspaceId ?? null;
	const select = useCallback(
		(state: WorkspacesState) =>
			workspaceId === null
				? null
				: (state.workspaces.find((workspace) => workspace.id === workspaceId) ?? null),
		[workspaceId],
	);
	return useDomainObjectState(Workspaces, select) ?? null;
}

/** Where a work session works: its copy, else its workspace's primary folder. */
export function workSessionDirectory(
	workSession: WorkSession,
	workspace: Workspace | null,
): string | null {
	return (
		workSession.directory ??
		workspace?.folders.find((folder) => folder.isPrimary)?.path ??
		workspace?.folders[0]?.path ??
		null
	);
}

/** {@link workSessionDirectory} for a component, following the workspace. */
export function useWorkSessionDirectory(workSession: WorkSession): string | null {
	return workSessionDirectory(workSession, useWorkSessionWorkspace(workSession));
}
