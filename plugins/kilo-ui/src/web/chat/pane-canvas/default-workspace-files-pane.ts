import type { Arrangement } from "@anaconda-agentic-desktop/pane-layout";

import type { RightPanelTab } from "../right-panel/right-panel-tab-registry.js";

export const FILES_PANE_DEFINITION_ID = "files.files";
export const FILES_EXPLORER_PANE_ID = "files:explorer";
export const FILES_EXPLORER_TAB_TITLE = "Files";
export const FILES_EXPLORER_PREFERRED_WIDTH = 280;
export const DEFAULT_WORKSPACE_FILES_ARRANGEMENT: Arrangement = "tiles";

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

export function shouldOpenDefaultFilesExplorer(args: {
	readonly submitted: boolean;
	readonly hasWorkspace: boolean;
	readonly filesAvailable: boolean;
	readonly tabs: readonly Pick<RightPanelTab, "definitionId" | "metadata">[];
}): boolean {
	if (!args.submitted || !args.hasWorkspace || !args.filesAvailable) return false;
	return !args.tabs.some(isFilesExplorerTab);
}
