/**
 * Renderer capability that lets other plugins (via `sdk.plugins.get`) inspect
 * and mutate the chat right-panel store without importing kilo-ui UI modules.
 *
 * Open notebooks are right-panel tabs with {@link NOTEBOOK_TAB_DEFINITION_ID};
 * the tab `instanceId` is nteract's `notebook_id` (bare UUID).
 */
import {
	selectSessionRightPanelState,
	useRightPanelStore,
	type RightPanelTab,
} from "./right-panel-store.js";

/** `contributionDefinitionId({ featureId: "notebook", id: "notebook" })`. */
export const NOTEBOOK_TAB_DEFINITION_ID = "notebook.notebook";

export const NOTEBOOK_TAB_TITLE = "Notebook";

/**
 * Maps a right-panel tab instance id onto the id nteract / runt MCP expect.
 *
 * New tabs use a bare UUID. Legacy sessions may still carry
 * `notebook.notebook:<uuid>` from before the bare-id fix — strip that prefix
 * so list/open tools and the iframe handshake share one daemon room.
 */
export function notebookIdFromInstanceId(instanceId: string): string {
	const prefix = `${NOTEBOOK_TAB_DEFINITION_ID}:`;
	return instanceId.startsWith(prefix) ? instanceId.slice(prefix.length) : instanceId;
}

export type ChatRightPanelNotebookTab = {
	readonly notebook_id: string;
	readonly title: string;
	readonly active: boolean;
};

export type ChatRightPanelCapability = {
	setFocusedSessionId(sessionId: string | null): void;
	getFocusedSessionId(): string | null;
	listTabs(sessionId: string): readonly RightPanelTab[];
	listNotebookTabs(sessionId: string): readonly ChatRightPanelNotebookTab[];
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
		listNotebookTabs(sessionId) {
			const state = selectSessionRightPanelState(
				useRightPanelStore.getState().bySessionId,
				sessionId,
			);
			return state.tabs
				.filter((tab) => tab.definitionId === NOTEBOOK_TAB_DEFINITION_ID)
				.map((tab) => ({
					notebook_id: notebookIdFromInstanceId(tab.instanceId),
					title: tab.title,
					active: state.activeTabId === tab.instanceId,
				}));
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
