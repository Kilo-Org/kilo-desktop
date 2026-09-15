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
