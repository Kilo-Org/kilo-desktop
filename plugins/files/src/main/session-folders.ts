import type { PluginSdk } from "@kilo-desktop/kernel";
import {
	workSessionFolders,
	WorkSessions,
	Workspaces,
	type WorkSessionFolder,
} from "@kilo-desktop/plugin-work-sessions/contracts";

/** The folders a work session shows (its isolated copy standing in for the primary); none without a workspace. */
export function foldersOfWorkSession(sdk: PluginSdk, workSessionId: string): WorkSessionFolder[] {
	const workSession = sdk.domainObjects
		.get(WorkSessions)
		?.getState()
		.workSessions.find((candidate) => candidate.id === workSessionId);
	if (!workSession?.workspaceId) return [];
	const workspace = sdk.domainObjects
		.get(Workspaces)
		?.getState()
		.workspaces.find((candidate) => candidate.id === workSession.workspaceId);
	return workSessionFolders(
		(workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
		workSession.branch ? workSession.directory : null,
	);
}
