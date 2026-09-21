import { useAuiState } from "@assistant-ui/react";

import type { Workspace } from "../../contracts/workspaces/schemas.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { resolveChatWorkspace, resolveChatWorkspaceDirectory } from "./chat-workspace-directory.js";
import { useOptionalSessionActivity } from "./session-activity/SessionActivityProvider.js";

/** Active workspace's primary folder — the draft (session-less) resolution. */
export function useWorkspaceDirectory(): string | undefined {
	const { workspaces, activeWorkspaceId } = useWorkspacesFeature();
	return resolveChatWorkspaceDirectory({
		remoteId: undefined,
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
		remoteId: sessionWorkspaceId ? remoteId : undefined,
		activeWorkspaceId,
		sessionWorkspaceId,
		workspaces,
	};
}

/** Session workspace when the thread is bound, otherwise the active workspace. */
export function useThreadWorkspace(): Workspace | undefined {
	return resolveChatWorkspace(useThreadWorkspaceOptions());
}

export function useThreadWorkspaceDirectory(): string | undefined {
	return resolveChatWorkspaceDirectory(useThreadWorkspaceOptions());
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
	return resolveChatWorkspaceDirectory({
		remoteId: sessionWorkspaceId ? remoteId : undefined,
		activeWorkspaceId,
		sessionWorkspaceId,
		workspaces,
	});
}
