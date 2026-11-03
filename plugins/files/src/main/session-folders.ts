import type { PluginSdk } from "@kilo-desktop/kernel";
import { Sessions } from "@kilo-desktop/plugin-sessions/contracts";
import {
	sessionFolders,
	Workspaces,
	type SessionFolder,
} from "@kilo-desktop/plugin-workspaces/contracts";

/** The folders a Work Session shows (its worktree standing in for the primary); none without a workspace. */
export function foldersOfSession(sdk: PluginSdk, sessionId: string): SessionFolder[] {
	const session = sdk.domains
		.get(Sessions)
		?.getState()
		.sessions.find((candidate) => candidate.id === sessionId);
	if (!session?.workspaceId) return [];
	const workspace = sdk.domains
		.get(Workspaces)
		?.getState()
		.workspaces.find((candidate) => candidate.id === session.workspaceId);
	return sessionFolders(
		(workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
		session.worktreeBranch ? session.directory : null,
	);
}
