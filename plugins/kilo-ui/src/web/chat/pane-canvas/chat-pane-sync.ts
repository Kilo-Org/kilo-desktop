/**
 * Relays chat pane mutations across Electron windows so the main canvas stays
 * the layout source of truth.
 *
 * Popped-out panes boot a separate renderer with its own session store. Tools
 * that open notebooks (or other contributed panes) may run in that window;
 * without a relay the main canvas never sees the pane. Feature events are sent
 * to other renderers but also delivered locally before relay, so each payload
 * carries a renderer source ID that suppresses only the local echo.
 */
import type { SDK } from "@kilo-desktop/feature-sdk";

import type { ChatRightPanelCapability } from "../right-panel/chat-right-panel-capability.js";
import { useRightPanelStore, type RightPanelTab } from "../right-panel/right-panel-store.js";
import type { RightPanelTabUpdate } from "../right-panel/right-panel-tab-registry.js";

export const CHAT_PANE_TAB_OPENED_EVENT = "chat-pane-tab-opened";
export const CHAT_PANE_TAB_UPDATED_EVENT = "chat-pane-tab-updated";
const CHAT_PANE_SYNC_SOURCE_ID = crypto.randomUUID();

type ChatPaneOpenedPayload = {
	readonly sourceId?: string;
	readonly sessionId: string;
	readonly tab: RightPanelTab;
	readonly activate?: boolean;
};

type ChatPaneUpdatedPayload = {
	readonly sourceId?: string;
	readonly sessionId: string;
	readonly instanceId: string;
	readonly update: RightPanelTabUpdate;
};

export function bindChatPaneSync(
	sdk: SDK,
	panes: ChatRightPanelCapability,
): ChatRightPanelCapability {
	return {
		...panes,
		openContributedTab(sessionId, definition, options) {
			const tab = panes.openContributedTab(sessionId, definition, options);
			sdk.events.emit(CHAT_PANE_TAB_OPENED_EVENT, {
				sourceId: CHAT_PANE_SYNC_SOURCE_ID,
				sessionId,
				tab,
				activate: options?.activate !== false,
			});
			return tab;
		},
		updateTab(sessionId, instanceId, update) {
			panes.updateTab(sessionId, instanceId, update);
			sdk.events.emit(CHAT_PANE_TAB_UPDATED_EVENT, {
				sourceId: CHAT_PANE_SYNC_SOURCE_ID,
				sessionId,
				instanceId,
				update,
			});
		},
	};
}

export function listenChatPaneSync(sdk: SDK): () => void {
	const stopOpen = sdk.events.on(`kilo-ui.${CHAT_PANE_TAB_OPENED_EVENT}`, (payload) => {
		if (!isPaneOpenedPayload(payload)) return;
		if (payload.sourceId === CHAT_PANE_SYNC_SOURCE_ID) return;
		useRightPanelStore.getState().openTab(
			payload.sessionId,
			{ id: payload.tab.definitionId, title: payload.tab.title },
			{
				instanceId: payload.tab.instanceId,
				title: payload.tab.title,
				...(payload.tab.iconKey ? { iconKey: payload.tab.iconKey } : {}),
				...(payload.tab.metadata ? { metadata: payload.tab.metadata } : {}),
				...(payload.tab.transient ? { transient: true } : {}),
				activate: payload.activate !== false,
			},
		);
	});
	const stopUpdate = sdk.events.on(`kilo-ui.${CHAT_PANE_TAB_UPDATED_EVENT}`, (payload) => {
		if (!isPaneUpdatedPayload(payload)) return;
		if (payload.sourceId === CHAT_PANE_SYNC_SOURCE_ID) return;
		useRightPanelStore.getState().updateTab(payload.sessionId, payload.instanceId, payload.update);
	});
	return () => {
		stopOpen();
		stopUpdate();
	};
}

function isPaneOpenedPayload(value: unknown): value is ChatPaneOpenedPayload {
	if (typeof value !== "object" || value === null) return false;
	if (!("sessionId" in value) || typeof value.sessionId !== "string") return false;
	if (!("tab" in value) || typeof value.tab !== "object" || value.tab === null) return false;
	const tab = value.tab as Partial<RightPanelTab>;
	return (
		typeof tab.instanceId === "string" &&
		typeof tab.definitionId === "string" &&
		typeof tab.title === "string"
	);
}

function isPaneUpdatedPayload(value: unknown): value is ChatPaneUpdatedPayload {
	if (typeof value !== "object" || value === null) return false;
	if (!("sessionId" in value) || typeof value.sessionId !== "string") return false;
	if (!("instanceId" in value) || typeof value.instanceId !== "string") return false;
	return "update" in value && typeof value.update === "object" && value.update !== null;
}
