import { isRef, ref, type ObjectRef } from "@kilo-desktop/kernel";
import { Chat } from "@kilo-desktop/plugin-core/contracts";
import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

/** The agent pane kind's contribution key. */
export const AGENT_PANE_KIND = "kilo.chat/agent";

/** The plan pane kind: the plan agent's proposed plan for a chat, one per work session. */
export const PLAN_PANE_KIND = "kilo.chat/plan";

/** The subagent pane kind: one subagent's transcript, one pane per child chat. */
export const SUBAGENT_PANE_KIND = "kilo.chat/subagent";

/**
 * Pane metadata naming a Kilo chat (`ses_…`): the chat a subagent pane's
 * child was delegated by. Agent and plan panes kept their chat here before
 * panes had an `object` (origin's panes, adopted as they were); they show
 * it through `object` now.
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

/**
 * Subagent pane metadata before panes had an `object`: the child chat whose
 * transcript it shows. Its `object` names the child now.
 */
export const SUBAGENT_CHILD_SESSION_METADATA_KEY = "childSessionId";

/** A subagent pane's id: one pane per child chat (origin's tab instance id). */
export const subagentPaneId = (childChatId: string): string => `subagent:${childChatId}`;

/** The `object` of a pane showing a chat. */
export const chatPaneObject = (chatId: string): ObjectRef => ref(Chat, chatId);

/**
 * The chat a pane names: its `object` when that is a chat, else the chat
 * id an adopted pane kept in `metadataKey`. An agent pane naming none is a
 * new chat, whose first send creates it; a closed chat is reopened only by
 * opening a pane on it (the Agent button's menu, a layout preset).
 */
export function paneChatId(
	pane: Pick<Pane, "metadata"> & Partial<Pick<Pane, "object">>,
	metadataKey: string = CHAT_ID_METADATA_KEY,
): string | null {
	if (isRef(Chat, pane.object)) return pane.object.id;
	return pane.metadata[metadataKey] || null;
}

export interface PlanPaneAnchors {
	readonly anchorCallId: string;
	readonly newestAnchorCallId: string;
}

/** The plan pane's metadata for a chat's plan revision (the chat is its `object`). */
export function planPaneMetadata(anchors: PlanPaneAnchors): Record<string, string> {
	return {
		[PLAN_ANCHOR_CALL_ID_METADATA_KEY]: anchors.anchorCallId,
		[PLAN_NEWEST_ANCHOR_CALL_ID_METADATA_KEY]: anchors.newestAnchorCallId,
	};
}

/** The subagent pane's metadata: the chat that delegated it, when known (the child is its `object`). */
export function subagentPaneMetadata(parentChatId: string | null): Record<string, string> {
	return parentChatId ? { [CHAT_ID_METADATA_KEY]: parentChatId } : {};
}

/** The child chat a subagent pane shows. */
export const subagentPaneChildChatId = (pane: Pick<Pane, "metadata" | "object">): string | null =>
	paneChatId(pane, SUBAGENT_CHILD_SESSION_METADATA_KEY);

/** The chat that delegated a subagent pane's child, when known. */
export const subagentPaneParentChatId = (pane: Pick<Pane, "metadata">): string | null =>
	pane.metadata[CHAT_ID_METADATA_KEY] || null;
