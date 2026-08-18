import type { Workspace } from "../../contracts/workspaces/schemas.js";

export function resolveChatWorkspaceDirectory(options: {
	readonly remoteId: string | undefined;
	readonly activeWorkspaceId: string | null;
	readonly sessionWorkspaceId: string | undefined;
	readonly workspaces: readonly Workspace[];
}): string | undefined {
	const workspaceId = options.remoteId?.trim()
		? options.sessionWorkspaceId
		: (options.activeWorkspaceId ?? undefined);
	if (!workspaceId) return undefined;

	const workspace = options.workspaces.find((candidate) => candidate.id === workspaceId);
	return workspace?.folders.find((folder) => folder.isPrimary)?.path ?? workspace?.folders[0]?.path;
}
