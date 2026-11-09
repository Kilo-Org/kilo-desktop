import {
	addPane,
	createLayout,
	descriptor,
	findPane,
	flattenPanes,
	parseLayoutJson,
	removePane,
	setActivePane,
	type PaneKind as LayoutKind,
	type PaneLayout,
} from "@kilo-desktop/pane-layout";
import type { WorkSessionPanes } from "@kilo-desktop/plugin-sessions/contracts";

/**
 * The canvas layout for a session's panes: the saved layout with panes
 * opened since added to the active group, closed ones removed, titles kept
 * current and the session's active pane shown. kilo.sessions owns which
 * panes exist; the layout only arranges them.
 */
export function sessionLayout(
	state: WorkSessionPanes,
	layoutKindOf: (kind: string) => LayoutKind,
): PaneLayout {
	let layout = parseLayoutJson(state.layout) ?? createLayout([]);
	const open = new Map(state.panes.map((pane) => [pane.id, pane]));
	for (const placed of flattenPanes(layout)) {
		if (!open.has(placed.id)) layout = removePane(layout, placed.id);
	}
	for (const pane of state.panes) {
		const placed = findPane(layout, pane.id);
		if (!placed) {
			layout = addPane(
				layout,
				descriptor({ id: pane.id, kind: layoutKindOf(pane.kind), title: pane.title }),
			);
		} else if (placed.title !== pane.title) {
			layout = retitle(layout, pane.id, pane.title);
		}
	}
	if (state.activePaneId && findPane(layout, state.activePaneId)) {
		layout = setActivePane(layout, state.activePaneId);
	}
	return layout;
}

function retitle(layout: PaneLayout, paneId: string, title: string): PaneLayout {
	return {
		...layout,
		groups: layout.groups.map((group) => ({
			...group,
			tabs: group.tabs.map((tab) => (tab.id === paneId ? { ...tab, title } : tab)),
		})),
	};
}
