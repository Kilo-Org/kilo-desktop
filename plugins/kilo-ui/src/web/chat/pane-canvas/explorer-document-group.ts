import {
	findPaneGroup,
	movePane,
	type PaneGroup,
	type PaneLayout,
} from "@anaconda-agentic-desktop/pane-layout";

import {
	FILES_EXPLORER_PANE_ID,
	isFilesDocumentTab,
	isFilesExplorerTab,
} from "./default-workspace-files-pane.js";
import type { RightPanelTab } from "../right-panel/right-panel-tab-registry.js";

export function placeExplorerBesideChat(layout: PaneLayout, paneId: string): PaneLayout {
	if (!findPaneGroup(layout, paneId)) return layout;
	const agentGroup = layout.groups.find((group) =>
		group.tabs.some((pane) => pane.kind === "agent"),
	);
	if (!agentGroup) return layout;
	const agentIndex = layout.groups.findIndex((group) => group.id === agentGroup.id);
	if (layout.groups[agentIndex + 1]?.tabs.some((pane) => pane.id === paneId)) return layout;
	return movePane(layout, paneId, agentGroup.id, "after");
}

export function placeNewExplorerDocument(
	layout: PaneLayout,
	tabs: readonly RightPanelTab[],
	paneId: string,
): PaneLayout {
	const tab = tabs.find((entry) => entry.instanceId === paneId);
	if (!tab || !isFilesDocumentTab(tab)) return layout;
	const explorers = tabs.filter(isFilesExplorerTab);
	const explorerId = documentExplorerId(tab, explorers);
	if (!explorerId) return layout;
	const fileGroup = findPaneGroup(layout, paneId);
	if (!fileGroup) return layout;
	const bound = boundDocumentGroup(layout, tabs, explorers, explorerId, paneId);
	if (bound) {
		if (fileGroup.id === bound.id) return layout;
		return movePane(layout, paneId, bound.id, "inside");
	}
	const explorerGroup = findPaneGroup(layout, explorerId);
	if (!explorerGroup || fileGroup.id === explorerGroup.id) return layout;
	return movePane(layout, paneId, explorerGroup.id, "after");
}

function documentExplorerId(
	tab: RightPanelTab,
	explorers: readonly RightPanelTab[],
): string | undefined {
	if (!isFilesDocumentTab(tab)) return undefined;
	const requested = tab.metadata?.explorerId;
	if (requested && explorers.some((explorer) => explorer.instanceId === requested)) {
		return requested;
	}
	const prefixed = explorers.find((explorer) =>
		tab.instanceId.startsWith(`file:${explorer.instanceId}:`),
	);
	if (prefixed) return prefixed.instanceId;
	if (explorers.some((explorer) => explorer.instanceId === FILES_EXPLORER_PANE_ID)) {
		return FILES_EXPLORER_PANE_ID;
	}
	return explorers.at(0)?.instanceId;
}

function boundDocumentGroup(
	layout: PaneLayout,
	tabs: readonly RightPanelTab[],
	explorers: readonly RightPanelTab[],
	explorerId: string,
	placingPaneId: string,
): PaneGroup | undefined {
	const explorerGroup = findPaneGroup(layout, explorerId);
	const owned = new Set(
		tabs
			.filter(
				(tab) =>
					documentExplorerId(tab, explorers) === explorerId && tab.instanceId !== placingPaneId,
			)
			.map((tab) => tab.instanceId),
	);
	if (owned.size === 0) return undefined;
	return layout.groups.find((group) => {
		if (explorerGroup && group.id === explorerGroup.id) return false;
		if (group.tabs.some((pane) => pane.kind === "agent")) return false;
		return group.tabs.some((pane) => owned.has(pane.id));
	});
}
