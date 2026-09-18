import {
	addPane,
	createLayout,
	descriptor,
	findPane,
	findPaneGroup,
	flattenPanes,
	parseLayoutJson,
	removePane,
	rewritePaneId,
	type PaneKind,
	type PaneLayout,
} from "@kilo-desktop/pane-layout";

import {
	FILES_EXPLORER_PANE_ID,
	FILES_PANE_DEFINITION_ID,
	FILES_EXPLORER_PREFERRED_WIDTH,
} from "./default-workspace-files-pane.js";
import { placeExplorerBesideChat, placeNewExplorerDocument } from "./explorer-document-group.js";
import type { RightPanelTab } from "../right-panel/right-panel-tab-registry.js";

export { rewritePaneId };

export const DEFAULT_CHAT_TITLE = "New Chat";

export function paneKindForDefinition(definitionId: string): PaneKind {
	if (definitionId === "notebook.notebook") return "notebook";
	if (definitionId === FILES_PANE_DEFINITION_ID) return "document";
	return "tool";
}

export function parseStoredLayout(layoutJson: string | undefined): PaneLayout {
	return parseLayoutJson(layoutJson) ?? createLayout([]);
}

export function agentPaneId(sessionId: string): string {
	return `agent:${sessionId}`;
}

export function isAgentPaneId(paneId: string): boolean {
	return paneId.startsWith("agent:");
}

export function ensureAgentPane(
	layout: PaneLayout,
	sessionId: string,
	aliases: readonly string[] = [],
	title = DEFAULT_CHAT_TITLE,
): PaneLayout {
	const paneId = agentPaneId(sessionId);
	if (findPane(layout, paneId)) return layout;
	for (const alias of aliases) {
		if (!alias || alias === paneId) continue;
		if (!findPane(layout, alias)) continue;
		return rewritePaneId(layout, alias, paneId);
	}
	const existing = flattenPanes(layout).find((pane) => pane.kind === "agent");
	if (existing) return rewritePaneId(layout, existing.id, paneId);
	return addPane(layout, descriptor({ id: paneId, kind: "agent", title }), { index: 0 });
}

export function mergeArtifactPanes(
	layout: PaneLayout,
	tabs: readonly RightPanelTab[],
	activeTabId?: string | null,
): PaneLayout {
	let next = layout;
	const tabIds = new Set(tabs.map((tab) => tab.instanceId));
	for (const pane of flattenPanes(layout)) {
		if (pane.kind === "agent") continue;
		if (!tabIds.has(pane.id)) next = removePane(next, pane.id);
	}
	for (const tab of tabs) {
		const existing = findPane(next, tab.instanceId);
		if (existing) {
			if (existing.title === tab.title) continue;
			const group = findPaneGroup(next, tab.instanceId);
			if (!group) continue;
			next = {
				...next,
				groups: next.groups.map((entry) =>
					entry.id === group.id
						? {
								...entry,
								tabs: entry.tabs.map((pane) =>
									pane.id === tab.instanceId ? { ...pane, title: tab.title } : pane,
								),
							}
						: entry,
				),
			};
			continue;
		}
		const previousActive = next.activePaneId;
		next = addPane(
			next,
			descriptor({
				id: tab.instanceId,
				kind: paneKindForDefinition(tab.definitionId),
				title: tab.title,
			}),
			tab.instanceId === FILES_EXPLORER_PANE_ID
				? { preferredWidth: FILES_EXPLORER_PREFERRED_WIDTH }
				: undefined,
		);
		next = placeNewExplorerDocument(next, tabs, tab.instanceId);
		if (tab.instanceId === FILES_EXPLORER_PANE_ID) {
			next = placeExplorerBesideChat(next, tab.instanceId);
		}
		if (activeTabId === tab.instanceId) continue;
		if (previousActive && findPane(next, previousActive)) {
			next = { ...next, activePaneId: previousActive };
		}
	}
	return next;
}

export function applyAgentPaneTitle(
	layout: PaneLayout,
	sessionId: string,
	title: string | undefined,
): PaneLayout {
	const paneId = agentPaneId(sessionId);
	const nextTitle = title?.trim() || DEFAULT_CHAT_TITLE;
	const pane = findPane(layout, paneId);
	if (!pane || pane.title === nextTitle) return layout;
	const group = findPaneGroup(layout, paneId);
	if (!group) return layout;
	return {
		...layout,
		groups: layout.groups.map((entry) =>
			entry.id === group.id
				? {
						...entry,
						tabs: entry.tabs.map((tab) => (tab.id === paneId ? { ...tab, title: nextTitle } : tab)),
					}
				: entry,
		),
	};
}

export function syncChatLayout(args: {
	layout: PaneLayout;
	sessionId: string;
	aliases?: readonly string[];
	tabs: readonly RightPanelTab[];
	title?: string | undefined;
	activeTabId?: string | null;
	showAgent?: boolean;
}): PaneLayout {
	let withAgent = args.layout;
	if (args.showAgent === false) {
		for (const pane of flattenPanes(withAgent)) {
			if (pane.kind === "agent") withAgent = removePane(withAgent, pane.id);
		}
	} else {
		withAgent = ensureAgentPane(withAgent, args.sessionId, args.aliases ?? [], args.title);
	}
	return applyAgentPaneTitle(
		mergeArtifactPanes(withAgent, args.tabs, args.activeTabId),
		args.sessionId,
		args.title,
	);
}
