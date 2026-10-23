import {
	descriptor,
	getPaneColumns,
	PANE_MIN_WIDTH,
	serializeLayout,
	type PaneDescriptor,
	type PaneLayout,
} from "@kilo-desktop/pane-layout";
import type { LayoutTemplate } from "../../../contracts/layout-presets/schemas.js";
import type { SessionRightPanelState } from "../right-panel/right-panel-store.js";
import {
	createContributedTab,
	type RightPanelTab,
} from "../right-panel/right-panel-tab-registry.js";
import { agentPaneId, paneKindForDefinition } from "../pane-canvas/pane-layout-state.js";

const REUSABLE_PANES = {
	changes: { id: "git.changes", title: "Changes" },
	terminal: { id: "terminal.terminal", title: "Terminal" },
	files: { id: "files.files", title: "Files" },
} as const;

function reusableType(
	tab: RightPanelTab | undefined,
): Exclude<LayoutTemplate["slots"][number]["type"], "chat"> | undefined {
	if (!tab || tab.transient) return undefined;
	if (tab.definitionId === REUSABLE_PANES.files.id && tab.metadata?.relativePath != null)
		return undefined;
	return (Object.keys(REUSABLE_PANES) as (keyof typeof REUSABLE_PANES)[]).find(
		(type) => REUSABLE_PANES[type].id === tab.definitionId,
	);
}

export function captureLayoutTemplate(
	layout: PaneLayout,
	state: SessionRightPanelState,
): {
	template: LayoutTemplate;
	omittedTitles: string[];
} {
	const slots: LayoutTemplate["slots"] = [];
	const groups: LayoutTemplate["groups"] = [];
	const omittedTitles: string[] = [];
	let activePaneId: string | undefined;
	for (const column of getPaneColumns(layout.groups, layout.sizes)) {
		const columnGroups: LayoutTemplate["groups"] = [];
		for (const group of column.groups) {
			const ids = new Map<string, string>();
			for (const pane of group.tabs) {
				const type =
					pane.kind === "agent"
						? "chat"
						: reusableType(state.tabs.find((tab) => tab.instanceId === pane.id));
				if (!type) {
					omittedTitles.push(pane.title);
					continue;
				}
				const id = `slot-${slots.length + 1}`;
				slots.push({ id, type });
				ids.set(pane.id, id);
				if (pane.id === layout.activePaneId) activePaneId = id;
			}
			const tabs = [...ids.values()];
			if (!tabs.length) continue;
			columnGroups.push({
				id: `group-${groups.length + columnGroups.length + 1}`,
				tabs,
				activePaneId: ids.get(group.activePaneId) ?? tabs[0]!,
				width: column.width,
				pinned: column.pinned,
				...(group.stackWeight === undefined ? {} : { stackWeight: group.stackWeight }),
			});
		}
		const total = columnGroups.reduce((sum, group) => sum + (group.stackWeight ?? 1), 0);
		for (const group of columnGroups) {
			if (columnGroups.length > 1) {
				group.stackId = `stack-${groups.length + 1}`;
				group.stackWeight = (group.stackWeight ?? 1) / total;
			} else delete group.stackWeight;
		}
		groups.push(...columnGroups);
	}
	return {
		template: {
			version: 1,
			arrangement: state.arrangement ?? "tiles",
			activePaneId: activePaneId ?? groups[0]!.activePaneId,
			slots,
			groups,
		},
		omittedTitles,
	};
}

export function applyLayoutTemplate(
	template: LayoutTemplate,
	sessionId: string,
	current: SessionRightPanelState,
	availableDefinitionIds?: ReadonlySet<string>,
): SessionRightPanelState {
	const tabs = [...current.tabs];
	const used = new Set<string>();
	const panes = new Map<string, PaneDescriptor>();
	for (const slot of template.slots) {
		if (slot.type === "chat") {
			panes.set(slot.id, descriptor({ id: agentPaneId(sessionId), kind: "agent", title: "Chat" }));
			continue;
		}
		if (availableDefinitionIds && !availableDefinitionIds.has(REUSABLE_PANES[slot.type].id)) {
			continue;
		}
		let tab = tabs.find(
			(entry) => !used.has(entry.instanceId) && reusableType(entry) === slot.type,
		);
		if (!tab) {
			tab = createContributedTab(tabs, REUSABLE_PANES[slot.type]);
			tabs.push(tab);
		}
		used.add(tab.instanceId);
		panes.set(
			slot.id,
			descriptor({
				id: tab.instanceId,
				kind: paneKindForDefinition(tab.definitionId),
				title: tab.title,
			}),
		);
	}
	const groups = template.groups.flatMap((group) => {
		const groupPanes = group.tabs.flatMap((id) => {
			const pane = panes.get(id);
			return pane ? [pane] : [];
		});
		if (!groupPanes.length) return [];
		return [
			{
				id: `preset:${group.id}`,
				tabs: groupPanes,
				activePaneId: panes.get(group.activePaneId)?.id ?? groupPanes[0]!.id,
				preferredWidth: Math.max(PANE_MIN_WIDTH, group.width),
				minWidth: PANE_MIN_WIDTH,
				pinned: group.pinned,
				...(group.stackId ? { stackId: `preset:${group.stackId}` } : {}),
				...(group.stackWeight === undefined ? {} : { stackWeight: group.stackWeight }),
			},
		];
	});
	for (const group of groups) {
		if (!group.stackId) continue;
		const stack = groups.filter((candidate) => candidate.stackId === group.stackId);
		if (stack.length === 1) {
			delete group.stackId;
			delete group.stackWeight;
			continue;
		}
		const totalWeight = stack.reduce((sum, candidate) => sum + (candidate.stackWeight ?? 1), 0);
		for (const candidate of stack) {
			candidate.stackWeight = (candidate.stackWeight ?? 1) / totalWeight;
		}
	}
	const extraPanes = tabs
		.filter((tab) => !used.has(tab.instanceId))
		.map((tab) =>
			descriptor({
				id: tab.instanceId,
				kind: paneKindForDefinition(tab.definitionId),
				title: tab.title,
			}),
		);
	if (extraPanes.length) {
		groups.push({
			id: "preset-extra-panes",
			tabs: extraPanes,
			activePaneId: extraPanes[0]!.id,
			preferredWidth: 360,
			minWidth: PANE_MIN_WIDTH,
			pinned: false,
		});
	}
	if (!groups.length) {
		const chat = descriptor({ id: agentPaneId(sessionId), kind: "agent", title: "Chat" });
		groups.push({
			id: "preset-chat-fallback",
			tabs: [chat],
			activePaneId: chat.id,
			preferredWidth: 600,
			minWidth: PANE_MIN_WIDTH,
			pinned: false,
		});
	}
	const activePaneId =
		(template.activePaneId === undefined ? undefined : panes.get(template.activePaneId)?.id) ??
		groups[0]?.activePaneId ??
		"";
	return {
		...current,
		tabs,
		chatPaneOpen:
			template.slots.some((slot) => slot.type === "chat") ||
			groups.some((group) => group.tabs.some((pane) => pane.kind === "agent")),
		arrangement: template.arrangement,
		activeTabId: activePaneId === agentPaneId(sessionId) ? null : activePaneId || null,
		layoutJson: serializeLayout({
			groups,
			activePaneId,
			sizes: Object.fromEntries(groups.map((group) => [group.id, group.preferredWidth])),
		}),
	};
}
