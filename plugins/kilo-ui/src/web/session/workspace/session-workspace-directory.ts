import type { Workspace } from "../../../contracts/workspaces/schemas.js";

interface SessionWorkspaceOptions {
	/** A draft follows the sidebar's active workspace; a started session keeps its own. */
	readonly followsActiveWorkspace: boolean;
	readonly activeWorkspaceId: string | null;
	readonly sessionWorkspaceId: string | undefined;
	readonly workspaces: readonly Workspace[];
}

export function resolveSessionWorkspace(options: SessionWorkspaceOptions): Workspace | undefined {
	const workspaceId = options.followsActiveWorkspace
		? (options.activeWorkspaceId ?? undefined)
		: options.sessionWorkspaceId;
	if (!workspaceId) return undefined;
	return options.workspaces.find((candidate) => candidate.id === workspaceId);
}

export function resolveSessionWorkspaceDirectory(
	options: SessionWorkspaceOptions,
): string | undefined {
	const workspace = resolveSessionWorkspace(options);
	return workspace?.folders.find((folder) => folder.isPrimary)?.path ?? workspace?.folders[0]?.path;
}
