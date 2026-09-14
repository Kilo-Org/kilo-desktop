"use client";

import { useAuiState } from "@assistant-ui/react";
import { type FC } from "react";

import { useWorkspacesFeature } from "../../../workspaces/WorkspacesFeatureContext.js";
import { useSessionActivity } from "../../session-activity/SessionActivityProvider.js";
import {
	useSessionListPins,
	useSessionListView,
} from "../../session-list/use-session-list-view.js";
import { SessionListContent } from "./session-list-content.js";

export const SessionList: FC = () => {
	const { view, update, reset } = useSessionListView();
	const { ids: pinIds, toggle: togglePin } = useSessionListPins();
	const threadIds = useAuiState((s) => s.threads.threadIds);
	const archivedThreadIds = useAuiState((s) => s.threads.archivedThreadIds);
	const threadItems = useAuiState((s) => s.threads.threadItems);
	const isLoading = useAuiState((s) => s.threads.isLoading);
	const activityBySessionId = useSessionActivity((s) => s.sessions);
	const { workspaces, setActiveWorkspaceId } = useWorkspacesFeature();

	return (
		<SessionListContent
			view={view}
			updateView={update}
			resetView={reset}
			pinIds={pinIds}
			togglePin={togglePin}
			threadIds={threadIds}
			archivedThreadIds={archivedThreadIds}
			threadItems={threadItems}
			isLoading={isLoading}
			activityBySessionId={activityBySessionId}
			workspaces={workspaces}
			setActiveWorkspaceId={setActiveWorkspaceId}
		/>
	);
};
