"use client";

import { useAuiState } from "@assistant-ui/react";
import { useMemo, type ComponentType, type FC } from "react";

import { useSdk, useSdkContributions } from "@kilo-desktop/sdk-react";

import { useWorkspacesFeature } from "../../../workspaces/WorkspacesFeatureContext.js";
import { useGitPullRequestStatus } from "../../git-pull-request-status.js";
import { useSessionActivity } from "../../session-activity/SessionActivityProvider.js";
import {
	sessionGitStatusId,
	withDescendantPrompts,
} from "../../session-activity/session-activity-logic.js";
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
	const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
	const isLoading = useAuiState((s) => s.threads.isLoading);
	const hasMoreThreads = useAuiState((s) => s.threads.hasMore);
	const activityBySessionId = useSessionActivity((s) => s.sessions);
	const promptAwareActivityBySessionId = useSessionActivity((s) =>
		withDescendantPrompts(s.sessions),
	);
	const { workspaces, setActiveWorkspaceId } = useWorkspacesFeature();
	const metadataProviders = useSdkContributions("kilo-ui/chat-session-metadata-provider");
	const pullRequestByStatusId = useGitPullRequestStatus(useSdk("kilo-ui"));
	const prTargets = useMemo(() => {
		const activeRemoteId = threadItems.find((item) => item.id === mainThreadId)?.remoteId;
		const byId = new Map<
			string,
			{ id: string; directory: string; active: boolean; branch?: string }
		>();
		for (const [sessionId, activity] of Object.entries(activityBySessionId)) {
			const id = sessionGitStatusId(activity);
			if (!activity.directory || !id) continue;
			const current = byId.get(id);
			byId.set(id, {
				id,
				directory: activity.directory,
				active: current?.active === true || sessionId === activeRemoteId,
				...(activity.worktreeBranch ? { branch: activity.worktreeBranch } : {}),
			});
		}
		return [...byId.values()];
	}, [activityBySessionId, mainThreadId, threadItems]);

	return (
		<>
			{metadataProviders.map((contribution) => {
				const Component = contribution.component as ComponentType<{
					targets: readonly { id: string; directory: string; active: boolean; branch?: string }[];
				}>;
				return (
					<Component key={`${contribution.featureId}.${contribution.id}`} targets={prTargets} />
				);
			})}
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
