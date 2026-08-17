/**
 * Renderer capability that lets other plugins (via `sdk.plugins.get`) inspect
 * and mutate the chat right-panel store without importing kilo-ui UI modules.
 */
import {
	selectSessionRightPanelState,
	useRightPanelStore,
	type RightPanelTab,
} from "./right-panel-store.js";
import type { CreateContributedTabOptions } from "./right-panel-tab-registry.js";

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
	setTabTitle(sessionId: string, instanceId: string, title: string): void;
	setTabDirty(sessionId: string, instanceId: string, dirty: boolean): void;
	registerTabLifecycle(
		sessionId: string,
		instanceId: string,
		lifecycle: RightPanelTabLifecycle,
	): () => void;
	getTabLifecycle(sessionId: string, instanceId: string): RightPanelTabLifecycle | undefined;
	show(sessionId: string): void;
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
			const conflictingTab = requestedInstanceId
				? selectSessionRightPanelState(
						useRightPanelStore.getState().bySessionId,
						sessionId,
					).tabs.find(
						(tab) => tab.instanceId === requestedInstanceId && tab.definitionId !== definition.id,
					)
				: undefined;
			if (conflictingTab) {
				throw new Error(
					`Right-panel tab id "${requestedInstanceId}" is already owned by "${conflictingTab.definitionId}".`,
				);
			}
			useRightPanelStore.getState().openTab(sessionId, definition, options);
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
		setTabTitle(sessionId, instanceId, title) {
			useRightPanelStore.getState().setTabTitle(sessionId, instanceId, title);
		},
		setTabDirty(sessionId, instanceId, dirty) {
			useRightPanelStore.getState().setTabDirty(sessionId, instanceId, dirty);
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
		show(sessionId) {
			useRightPanelStore.getState().show(sessionId);
		},
	};
}

/** Process-local singleton — the right-panel store is already a module singleton. */
export const chatRightPanelCapability = createChatRightPanelCapability();
