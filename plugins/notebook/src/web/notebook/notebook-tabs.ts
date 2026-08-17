export const NOTEBOOK_TAB_DEFINITION_ID = "notebook.notebook";
export const NOTEBOOK_TAB_TITLE = "Notebook";

export interface ChatRightPanelTabSnapshot {
	readonly instanceId: string;
	readonly definitionId: string;
	readonly title: string;
}

export interface ChatRightPanelNotebookTab {
	readonly notebook_id: string;
	readonly title: string;
	readonly active: boolean;
}

/** Legacy right-panel ids were prefixed before Kilo switched to opaque UUIDs. */
export function notebookIdFromInstanceId(instanceId: string): string {
	const prefix = `${NOTEBOOK_TAB_DEFINITION_ID}:`;
	return instanceId.startsWith(prefix) ? instanceId.slice(prefix.length) : instanceId;
}

export function selectNotebookTabs(
	tabs: readonly ChatRightPanelTabSnapshot[],
	activeTabId: string | null,
): readonly ChatRightPanelNotebookTab[] {
	return tabs
		.filter((tab) => tab.definitionId === NOTEBOOK_TAB_DEFINITION_ID)
		.map((tab) => ({
			notebook_id: notebookIdFromInstanceId(tab.instanceId),
			title: tab.title,
			active: tab.instanceId === activeTabId,
		}));
}
