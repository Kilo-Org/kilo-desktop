/**
 * Renderer capability that lets other plugins (via `sdk.plugins.get`) inspect
 * and mutate the chat right-panel store without importing kilo-ui UI modules.
 */
import {
	selectSessionRightPanelState,
	useRightPanelStore,
	type RightPanelTab,
} from "./right-panel-store.js";

export type ChatRightPanelCapability = {
	setFocusedSessionId(sessionId: string | null): void;
	getFocusedSessionId(): string | null;
	listTabs(sessionId: string): readonly RightPanelTab[];
	getActiveTabId(sessionId: string): string | null;
	openContributedTab(
		sessionId: string,
		definition: { readonly id: string; readonly title: string },
	): RightPanelTab;
	activateTab(sessionId: string, instanceId: string): void;
	show(sessionId: string): void;
};

/** Shape returned by `sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")`. */
export type ChatRightPanelCapabilities = {
	readonly chatRightPanel: ChatRightPanelCapability;
};

export function createChatRightPanelCapability(): ChatRightPanelCapability {
	let focusedSessionId: string | null = null;

	return {
		setFocusedSessionId(sessionId) {
			focusedSessionId = sessionId;
		},
		getFocusedSessionId() {
			return focusedSessionId;
		},
		listTabs(sessionId) {
			return selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, sessionId)
				.tabs;
		},
		getActiveTabId(sessionId) {
			return selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, sessionId)
				.activeTabId;
		},
		openContributedTab(sessionId, definition) {
			useRightPanelStore.getState().openTab(sessionId, definition);
			const state = selectSessionRightPanelState(
				useRightPanelStore.getState().bySessionId,
				sessionId,
			);
			const opened =
				state.tabs.find((tab) => tab.instanceId === state.activeTabId) ??
				state.tabs.find((tab) => tab.definitionId === definition.id);
			if (!opened) {
				throw new Error(`Failed to open right-panel tab for definition "${definition.id}".`);
			}
			return opened;
		},
		activateTab(sessionId, instanceId) {
			useRightPanelStore.getState().activateTab(sessionId, instanceId);
		},
		show(sessionId) {
			useRightPanelStore.getState().show(sessionId);
		},
	};
}

/** Process-local singleton — the right-panel store is already a module singleton. */
export const chatRightPanelCapability = createChatRightPanelCapability();
