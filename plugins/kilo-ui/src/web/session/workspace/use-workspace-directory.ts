import { useAuiState } from "@assistant-ui/react";

import type { Workspace } from "../../../contracts/workspaces/schemas.js";
import { useWorkspacesFeature } from "../../workspaces/WorkspacesFeatureContext.js";
import {
	resolveSessionWorkspace,
	resolveSessionWorkspaceDirectory,
} from "./session-workspace-directory.js";
import { useOptionalSessionActivity } from "../activity/SessionActivityProvider.js";

/** Active workspace's primary folder — the draft (session-less) resolution. */
export function useWorkspaceDirectory(): string | undefined {
	const { workspaces, activeWorkspaceId } = useWorkspacesFeature();
	return resolveSessionWorkspaceDirectory({
		followsActiveWorkspace: true,
		activeWorkspaceId,
		sessionWorkspaceId: undefined,
		workspaces,
	});
}

function useThreadWorkspaceOptions() {
	const { workspaces, activeWorkspaceId } = useWorkspacesFeature();
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const sessionWorkspaceId = useOptionalSessionActivity((state) =>
		remoteId ? state.sessions[remoteId]?.workspaceId : undefined,
	);
	return {
		followsActiveWorkspace: !remoteId || !sessionWorkspaceId,
		activeWorkspaceId,
		sessionWorkspaceId,
		workspaces,
	};
}

/** Session workspace when the thread is bound, otherwise the active workspace. */
export function useThreadWorkspace(): Workspace | undefined {
	return resolveSessionWorkspace(useThreadWorkspaceOptions());
}

export function useThreadWorkspaceDirectory(): string | undefined {
	return resolveSessionWorkspaceDirectory(useThreadWorkspaceOptions());
}

/**
 * The session's effective working directory: the worktree path when the
 * thread runs in a kilo-managed worktree, otherwise the workspace primary
 * (same as `useThreadWorkspaceDirectory`).
 */
export function useThreadWorkingDirectory(): string | undefined {
	const { workspaces, activeWorkspaceId } = useWorkspacesFeature();
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const worktreeDirectory = useOptionalSessionActivity((state) => {
		const session = remoteId ? state.sessions[remoteId] : undefined;
		return session?.worktreeBranch !== undefined && session.directory !== undefined
			? session.directory
			: undefined;
	});
	const sessionWorkspaceId = useOptionalSessionActivity((state) =>
		remoteId ? state.sessions[remoteId]?.workspaceId : undefined,
	);
	if (worktreeDirectory !== undefined) return worktreeDirectory;
	return resolveSessionWorkspaceDirectory({
		followsActiveWorkspace: !remoteId || !sessionWorkspaceId,
		activeWorkspaceId,
		sessionWorkspaceId,
		workspaces,
	});
}
