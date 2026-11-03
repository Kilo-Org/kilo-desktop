import type { Pane, Session } from "@kilo-desktop/plugin-sessions/contracts";

/** The agent pane kind's contribution key. */
export const AGENT_PANE_KIND = "kilo.chat/agent";

/** The plan pane kind: the plan agent's proposed plan for a chat, one per session. */
export const PLAN_PANE_KIND = "kilo.chat/plan";

/** The subagent pane kind: one subagent's transcript, one pane per child chat. */
export const SUBAGENT_PANE_KIND = "kilo.chat/subagent";

/**
 * Pane metadata naming the Kilo chat (`ses_…`) a pane shows: an agent pane's
 * chat, the chat a plan pane shows the plan of, or the chat that delegated a
 * subagent pane's child.
 */
export const CHAT_ID_METADATA_KEY = "chatId";

/** Plan pane metadata: the `write` / `plan_exit` call of the plan revision that was opened. */
export const PLAN_ANCHOR_CALL_ID_METADATA_KEY = "planAnchorCallId";

/**
 * Plan pane metadata: the newest finished revision when the pane was opened.
 * A newer revision finishing later replaces the one opened; one still being
 * written does not.
 */
export const PLAN_NEWEST_ANCHOR_CALL_ID_METADATA_KEY = "planNewestAnchorCallIdAtOpen";

/** Subagent pane metadata: the child chat (`ses_…`) whose transcript it shows. */
export const SUBAGENT_CHILD_SESSION_METADATA_KEY = "childSessionId";

/** A subagent pane's id: one pane per child chat (origin's tab instance id). */
export const subagentPaneId = (childSessionId: string): string => `subagent:${childSessionId}`;

/**
 * The chat an agent or plan pane shows: the one named in its metadata, else
 * its session's first chat (origin's panes, handed over without metadata),
 * else none — for an agent pane, a draft whose first send creates the chat.
 */
export function agentPaneChatId(
	pane: Pick<Pane, "metadata">,
	session: Pick<Session, "chatIds"> | null | undefined,
): string | null {
	return pane.metadata[CHAT_ID_METADATA_KEY] ?? session?.chatIds[0] ?? null;
}

export interface PlanPaneAnchors {
	readonly anchorCallId: string;
	readonly newestAnchorCallId: string;
}

/** The plan pane's metadata for a chat's plan revision. */
export function planPaneMetadata(chatId: string, anchors: PlanPaneAnchors): Record<string, string> {
	return {
		[CHAT_ID_METADATA_KEY]: chatId,
		[PLAN_ANCHOR_CALL_ID_METADATA_KEY]: anchors.anchorCallId,
		[PLAN_NEWEST_ANCHOR_CALL_ID_METADATA_KEY]: anchors.newestAnchorCallId,
	};
}

/** The subagent pane's metadata for `childChatId`, delegated by `parentChatId` when known. */
export function subagentPaneMetadata(
	childChatId: string,
	parentChatId: string | null,
): Record<string, string> {
	return {
		[SUBAGENT_CHILD_SESSION_METADATA_KEY]: childChatId,
		...(parentChatId ? { [CHAT_ID_METADATA_KEY]: parentChatId } : {}),
	};
}
