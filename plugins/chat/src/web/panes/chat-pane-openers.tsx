import { useMemo, type ReactNode } from "react";

import { useDomain } from "@kilo-desktop/kernel/web";
import { Panes } from "@kilo-desktop/plugin-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	MEDIA_ITEM_METADATA_KEY,
	MEDIA_PANE_KIND,
	mediaItemTitle,
	mediaPaneId,
	MediaViewers,
	mediaViewerKey,
	PLAN_PANE_KIND,
	planPaneMetadata,
	SUBAGENT_PANE_KIND,
	subagentPaneId,
	subagentPaneMetadata,
} from "../../contracts";
import {
	OpenMediaPaneContext,
	prepareViewerItems,
	type OpenMediaPane,
} from "../media/open-media-pane";
import { dropViewerHandoff, handOffViewerItems } from "../media/viewer-handoff";
import { OpenPlanPaneContext, type OpenPlanPane } from "../plan/open-plan-pane";
import {
	OpenSubagentPaneContext,
	type OpenSubagentPane,
} from "../subagents/use-open-subagent-pane";

function reportOpenFailure(error: unknown): void {
	toast.error("Could not open the pane", {
		description: error instanceof Error && error.message ? error.message : undefined,
	});
}

/**
 * Lets a transcript open its chat's plan (the session's one Plan pane, on the
 * revision clicked), its subagents (one Subagent pane per child chat) and its
 * diagrams and images (the chat's one Viewer pane, on the item clicked)
 * through kilo.sessions' panes. `chatId` is the chat the transcript shows.
 */
export function ChatPaneOpeners({
	sessionId,
	chatId,
	children,
}: {
	/** Null before the session exists: nothing can be opened yet. */
	sessionId: string | null;
	chatId: string | null;
	children: ReactNode;
}) {
	const panes = useDomain(Panes);
	const viewers = useDomain(MediaViewers);
	const openPlan = useMemo<OpenPlanPane | null>(
		() =>
			panes && chatId && sessionId
				? (anchors) =>
						void panes.methods
							.open({
								sessionId,
								kind: PLAN_PANE_KIND,
								title: "Plan",
								metadata: planPaneMetadata(chatId, anchors),
							})
							.catch(reportOpenFailure)
				: null,
		[chatId, panes, sessionId],
	);
	const openSubagent = useMemo<OpenSubagentPane | null>(
		() =>
			panes && sessionId
				? (childSessionId, title) =>
						void panes.methods
							.open({
								sessionId,
								kind: SUBAGENT_PANE_KIND,
								paneId: subagentPaneId(childSessionId),
								title,
								metadata: subagentPaneMetadata(childSessionId, chatId),
							})
							.catch(reportOpenFailure)
				: null,
		[chatId, panes, sessionId],
	);
	const openMedia = useMemo<OpenMediaPane | null>(
		() =>
			panes && viewers && sessionId
				? async (items, itemId) => {
						const paneId = mediaPaneId(chatId);
						const key = mediaViewerKey(sessionId, paneId);
						try {
							const shown = await prepareViewerItems(items, itemId);
							const item = shown.find((candidate) => candidate.id === itemId);
							if (!item) return false;
							const { revision } = await viewers.methods.show({ sessionId, paneId, items: shown });
							handOffViewerItems(key, revision, shown);
							try {
								await panes.methods.open({
									sessionId,
									kind: MEDIA_PANE_KIND,
									paneId,
									title: mediaItemTitle(item),
									iconKey: item.kind,
									metadata: { [MEDIA_ITEM_METADATA_KEY]: item.id },
								});
							} catch (error) {
								dropViewerHandoff(key);
								await viewers.methods.discard({ sessionId, paneId }).catch(() => undefined);
								throw error;
							}
							return true;
						} catch {
							// The caller shows the item in a dialog instead.
							return false;
						}
					}
				: null,
		[chatId, panes, sessionId, viewers],
	);
	return (
		<OpenPlanPaneContext.Provider value={openPlan}>
			<OpenSubagentPaneContext.Provider value={openSubagent}>
				<OpenMediaPaneContext.Provider value={openMedia}>{children}</OpenMediaPaneContext.Provider>
			</OpenSubagentPaneContext.Provider>
		</OpenPlanPaneContext.Provider>
	);
}
