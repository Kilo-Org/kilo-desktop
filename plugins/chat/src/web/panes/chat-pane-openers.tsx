import { useMemo, type ReactNode } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	MEDIA_ITEM_METADATA_KEY,
	MEDIA_PANE_KIND,
	mediaItemTitle,
	mediaPaneId,
	MediaViewers,
	mediaViewerKey,
	chatPaneObject,
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
 * Lets a transcript open its chat's plan (the work session's one Plan pane, on the
 * revision clicked), its subagents (one Subagent pane per child chat) and its
 * diagrams and images (the chat's one Viewer pane, on the item clicked)
 * through kilo.work-sessions' panes. `chatId` is the chat the transcript shows.
 */
export function ChatPaneOpeners({
	workSessionId,
	chatId,
	children,
}: {
	/** Null before the work session exists: nothing can be opened yet. */
	workSessionId: string | null;
	chatId: string | null;
	children: ReactNode;
}) {
	const panes = useDomainObject(Panes);
	const viewers = useDomainObject(MediaViewers);
	const openPlan = useMemo<OpenPlanPane | null>(
		() =>
			panes && chatId && workSessionId
				? (anchors) =>
						void panes.methods
							.open({
								workSessionId,
								kind: PLAN_PANE_KIND,
								title: "Plan",
								object: chatPaneObject(chatId),
								metadata: planPaneMetadata(anchors),
							})
							.catch(reportOpenFailure)
				: null,
		[chatId, panes, workSessionId],
	);
	const openSubagent = useMemo<OpenSubagentPane | null>(
		() =>
			panes && workSessionId
				? (childSessionId, title) =>
						void panes.methods
							.open({
								workSessionId,
								kind: SUBAGENT_PANE_KIND,
								paneId: subagentPaneId(childSessionId),
								title,
								object: chatPaneObject(childSessionId),
								metadata: subagentPaneMetadata(chatId),
							})
							.catch(reportOpenFailure)
				: null,
		[chatId, panes, workSessionId],
	);
	const openMedia = useMemo<OpenMediaPane | null>(
		() =>
			panes && viewers && workSessionId
				? async (items, itemId) => {
						const paneId = mediaPaneId(chatId);
						const key = mediaViewerKey(workSessionId, paneId);
						try {
							const shown = await prepareViewerItems(items, itemId);
							const item = shown.find((candidate) => candidate.id === itemId);
							if (!item) return false;
							const { revision } = await viewers.methods.show({
								workSessionId,
								paneId,
								items: shown,
							});
							handOffViewerItems(key, revision, shown);
							try {
								await panes.methods.open({
									workSessionId,
									kind: MEDIA_PANE_KIND,
									paneId,
									title: mediaItemTitle(item),
									iconKey: item.kind,
									metadata: { [MEDIA_ITEM_METADATA_KEY]: item.id },
								});
							} catch (error) {
								dropViewerHandoff(key);
								await viewers.methods.discard({ workSessionId, paneId }).catch(() => undefined);
								throw error;
							}
							return true;
						} catch {
							// The caller shows the item in a dialog instead.
							return false;
						}
					}
				: null,
		[chatId, panes, workSessionId, viewers],
	);
	return (
		<OpenPlanPaneContext.Provider value={openPlan}>
			<OpenSubagentPaneContext.Provider value={openSubagent}>
				<OpenMediaPaneContext.Provider value={openMedia}>{children}</OpenMediaPaneContext.Provider>
			</OpenSubagentPaneContext.Provider>
		</OpenPlanPaneContext.Provider>
	);
}
