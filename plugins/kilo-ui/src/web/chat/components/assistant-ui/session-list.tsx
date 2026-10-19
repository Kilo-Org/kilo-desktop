"use client";

import { useAuiState } from "@assistant-ui/react";
import type { FC } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import { useWorkspacesFeature } from "../../../workspaces/WorkspacesFeatureContext.js";
import { useGitPullRequestStatus } from "../../git-pull-request-status.js";
import { useSessionActivity } from "../../session-activity/SessionActivityProvider.js";
import { withDescendantPrompts } from "../../session-activity/session-activity-logic.js";
import {
	useSessionListPins,
	useSessionListView,
} from "../../session-list/use-session-list-view.js";
import { SessionListContent } from "./session-list-content.js";
import { SessionMetadataProviders } from "./session-metadata-providers.js";

export const SessionList: FC = () => {
	const { view, update, reset } = useSessionListView();
	const { ids: pinIds, toggle: togglePin } = useSessionListPins();
	const threadIds = useAuiState((s) => s.threads.threadIds);
	const archivedThreadIds = useAuiState((s) => s.threads.archivedThreadIds);
	const threadItems = useAuiState((s) => s.threads.threadItems);
	const isLoading = useAuiState((s) => s.threads.isLoading);
	const hasMoreThreads = useAuiState((s) => s.threads.hasMore);
	const promptAwareActivityBySessionId = useSessionActivity((s) =>
		withDescendantPrompts(s.sessions),
	);
	const { workspaces, setActiveWorkspaceId } = useWorkspacesFeature();
	const pullRequestByStatusId = useGitPullRequestStatus(useSdk("kilo-ui"));

	return (
		<>
			<SessionMetadataProviders />
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
				hasMoreThreads={hasMoreThreads}
				activityBySessionId={promptAwareActivityBySessionId}
				pullRequestByStatusId={pullRequestByStatusId}
				workspaces={workspaces}
				setActiveWorkspaceId={setActiveWorkspaceId}
			/>
		</>
	);
};
