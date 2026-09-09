/**
 * Renderer capability that lets other plugins (via `sdk.plugins.get`) inspect
 * and mutate the chat pane store without importing kilo-ui UI modules.
 */
import {
	selectSessionRightPanelState,
	useRightPanelStore,
	type RightPanelTab,
} from "./right-panel-store.js";
import type { CreateContributedTabOptions } from "./right-panel-tab-registry.js";
import type { RightPanelTabUpdate } from "./right-panel-tab-registry.js";

export type ChatRightPanelCapability = {
	setFocusedSessionId(sessionId: string | null): void;
	getFocusedSessionId(): string | null;
	listTabs(sessionId: string): readonly RightPanelTab[];
	getActiveTabId(sessionId: string): string | null;
	openContributedTab(
		sessionId: string,
		definition: { readonly id: string; readonly title: string },
		options?: CreateContributedTabOptions,
	): RightPanelTab;
	activateTab(sessionId: string, instanceId: string): void;
	updateTab(sessionId: string, instanceId: string, update: RightPanelTabUpdate): void;
	registerTabLifecycle(
		sessionId: string,
		instanceId: string,
		lifecycle: RightPanelTabLifecycle,
	): () => void;
	getTabLifecycle(sessionId: string, instanceId: string): RightPanelTabLifecycle | undefined;
};

export interface RightPanelTabSaveResult {
	readonly outcome: "saved" | "cancelled" | "failed";
	readonly reason?: string;
}

export interface RightPanelTabLifecycle {
	readonly save?: () => Promise<RightPanelTabSaveResult>;
	readonly discard?: () => Promise<void>;
}

function lifecycleKey(sessionId: string, instanceId: string): string {
	return `${sessionId}\0${instanceId}`;
}

/** Shape returned by `sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")`. */
export type ChatRightPanelCapabilities = {
	readonly chatRightPanel: ChatRightPanelCapability;
};

export function createChatRightPanelCapability(): ChatRightPanelCapability {
	let focusedSessionId: string | null = null;
	const lifecycles = new Map<string, RightPanelTabLifecycle>();

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
		openContributedTab(sessionId, definition, options) {
			const requestedInstanceId = options?.instanceId;
			const previous = selectSessionRightPanelState(
				useRightPanelStore.getState().bySessionId,
				sessionId,
			);
			const conflictingTab = requestedInstanceId
				? previous.tabs.find(
						(tab) => tab.instanceId === requestedInstanceId && tab.definitionId !== definition.id,
					)
				: undefined;
			if (conflictingTab) {
				throw new Error(
					`Chat pane id "${requestedInstanceId}" is already owned by "${conflictingTab.definitionId}".`,
				);
			}
			useRightPanelStore.getState().openTab(sessionId, definition, options);
			const state = selectSessionRightPanelState(
				useRightPanelStore.getState().bySessionId,
				sessionId,
			);
			const opened = requestedInstanceId
				? state.tabs.find((tab) => tab.instanceId === requestedInstanceId)
				: state.tabs.find(
						(tab) => !previous.tabs.some((candidate) => candidate.instanceId === tab.instanceId),
					);
			if (!opened) {
				throw new Error(`Failed to open chat pane for definition "${definition.id}".`);
			}
			return opened;
		},
		activateTab(sessionId, instanceId) {
			useRightPanelStore.getState().activateTab(sessionId, instanceId);
		},
		updateTab(sessionId, instanceId, update) {
			useRightPanelStore.getState().updateTab(sessionId, instanceId, update);
		},
		registerTabLifecycle(sessionId, instanceId, lifecycle) {
			const key = lifecycleKey(sessionId, instanceId);
			lifecycles.set(key, lifecycle);
			return () => {
				if (lifecycles.get(key) === lifecycle) lifecycles.delete(key);
			};
		},
		getTabLifecycle(sessionId, instanceId) {
			return lifecycles.get(lifecycleKey(sessionId, instanceId));
		},
	};
}

/** Process-local singleton — the pane store is already a module singleton. */
export const chatRightPanelCapability = createChatRightPanelCapability();
