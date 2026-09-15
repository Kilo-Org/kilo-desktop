import type { RightPanelTab } from "../right-panel/right-panel-tab-registry.js";

export const FILES_PANE_DEFINITION_ID = "files.files";
export const FILES_EXPLORER_PANE_ID = "files:explorer";
export const FILES_EXPLORER_TAB_TITLE = "Files";
export const FILES_EXPLORER_PREFERRED_WIDTH = 280;

export function isFilesExplorerTab(tab: Pick<RightPanelTab, "definitionId" | "metadata">): boolean {
	return tab.definitionId === FILES_PANE_DEFINITION_ID && tab.metadata?.relativePath == null;
}

export function isFilesDocumentTab(tab: Pick<RightPanelTab, "definitionId" | "metadata">): boolean {
	return tab.definitionId === FILES_PANE_DEFINITION_ID && tab.metadata?.relativePath != null;
}

export function workspaceFolderName(path: string | undefined): string | undefined {
	if (!path) return undefined;
	const trimmed = path.replace(/[\\/]+$/u, "");
	return trimmed.split(/[\\/]/u).at(-1) || path;
}
