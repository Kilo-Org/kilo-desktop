import type { Workspace } from "../../contracts/workspaces/schemas.js";

interface ChatWorkspaceOptions {
	readonly remoteId: string | undefined;
	readonly activeWorkspaceId: string | null;
	readonly sessionWorkspaceId: string | undefined;
	readonly workspaces: readonly Workspace[];
}

export function resolveChatWorkspace(options: ChatWorkspaceOptions): Workspace | undefined {
	const workspaceId = options.remoteId?.trim()
		? options.sessionWorkspaceId
		: (options.activeWorkspaceId ?? undefined);
	if (!workspaceId) return undefined;
	return options.workspaces.find((candidate) => candidate.id === workspaceId);
}

export function resolveChatWorkspaceDirectory(options: ChatWorkspaceOptions): string | undefined {
	const workspace = resolveChatWorkspace(options);
	return workspace?.folders.find((folder) => folder.isPrimary)?.path ?? workspace?.folders[0]?.path;
}
