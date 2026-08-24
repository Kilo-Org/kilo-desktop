export const NOTEBOOK_TAB_DEFINITION_ID = "notebook.notebook";
export const NOTEBOOK_TAB_TITLE = "Notebook";
export const NOTEBOOK_PATH_METADATA_KEY = "notebookPath";
export const NOTEBOOK_ID_METADATA_KEY = "notebookId";
export const NOTEBOOK_OPEN_STATE_METADATA_KEY = "notebookOpenState";
export const NOTEBOOK_OPEN_ERROR_METADATA_KEY = "notebookOpenError";

export type NotebookOpenState = "opening" | "ready" | "error";

export interface ChatRightPanelTabSnapshot {
	readonly instanceId: string;
	readonly definitionId: string;
	readonly title: string;
	readonly metadata?: Readonly<Record<string, string>>;
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

export function notebookOpenState(
	metadata?: Readonly<Record<string, string>>,
): NotebookOpenState | undefined {
	const state = metadata?.[NOTEBOOK_OPEN_STATE_METADATA_KEY];
	return state === "opening" || state === "ready" || state === "error" ? state : undefined;
}

export function notebookIdFromTab(
	instanceId: string,
	metadata?: Readonly<Record<string, string>>,
): string | undefined {
	const notebookId = metadata?.[NOTEBOOK_ID_METADATA_KEY];
	if (notebookId) return notebookId;
	return notebookOpenState(metadata) ? undefined : notebookIdFromInstanceId(instanceId);
}

export function selectNotebookTabs(
	tabs: readonly ChatRightPanelTabSnapshot[],
	activeTabId: string | null,
): readonly ChatRightPanelNotebookTab[] {
	return tabs
		.filter((tab) => tab.definitionId === NOTEBOOK_TAB_DEFINITION_ID)
		.flatMap((tab) => {
			const notebookId = notebookIdFromTab(tab.instanceId, tab.metadata);
			return notebookId
				? [
						{
							notebook_id: notebookId,
							title: tab.title,
							active: tab.instanceId === activeTabId,
						},
					]
				: [];
		});
}
