import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { resolveChatWorkspaceDirectory } from "./chat-workspace-directory.js";

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
