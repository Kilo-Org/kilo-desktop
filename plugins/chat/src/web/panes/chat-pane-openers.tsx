import { useMemo, type ReactNode } from "react";

import { useDomain } from "@kilo-desktop/kernel/web";
import { Panes } from "@kilo-desktop/plugin-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	PLAN_PANE_KIND,
	planPaneMetadata,
	SUBAGENT_PANE_KIND,
	subagentPaneId,
	subagentPaneMetadata,
} from "../../contracts";
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
 * revision clicked) and its subagents (one Subagent pane per child chat)
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
	return (
		<OpenPlanPaneContext.Provider value={openPlan}>
			<OpenSubagentPaneContext.Provider value={openSubagent}>
				{children}
			</OpenSubagentPaneContext.Provider>
		</OpenPlanPaneContext.Provider>
	);
}
