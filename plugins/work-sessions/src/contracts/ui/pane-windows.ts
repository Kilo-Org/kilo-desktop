import type { DomainObjectState, KernelWindows } from "@kilo-desktop/kernel";
import { parseLayoutJson, setActivePane } from "@kilo-desktop/pane-layout";

import type { WorkSessionPanes } from "../model/panes";

/** The window view a popped-out pane opens in. */
export const PANE_WINDOW_VIEW = "kilo.work-sessions/pane";

type WindowsState = DomainObjectState<typeof KernelWindows>;
type WindowRecord = WindowsState["windows"][string];

/** A pane shown in its own window. */
export interface PaneWindow {
	readonly windowId: string;
	readonly workSessionId: string;
	readonly paneId: string;
	readonly hidden: boolean;
}

function paneWindowOf(windowId: string, window: WindowRecord): PaneWindow | null {
	const { workSessionId, paneId } = window.params;
	if (window.view !== PANE_WINDOW_VIEW || !workSessionId || !paneId) return null;
	return { windowId, workSessionId, paneId, hidden: window.hidden };
}

/** The popped-out panes among the kernel's windows (`kernel/windows`). */
export function paneWindows(state: WindowsState): PaneWindow[] {
	return Object.entries(state.windows).flatMap(([windowId, window]) => {
		const paneWindow = paneWindowOf(windowId, window);
		return paneWindow ? [paneWindow] : [];
	});
}

/**
 * The panes a work session puts on screen: the tab each group of its saved
 * layout shows, with the active pane shown in its group as the canvas does
 * (showing a pane doesn't save the layout), plus its popped-out panes.
 * Whether the work session itself is open is not considered.
 */
export function shownPaneIds(
	workSessionId: string,
	record: WorkSessionPanes,
	windows: WindowsState | null,
): Set<string> {
	const { activePaneId } = record;
	const saved = parseLayoutJson(record.layout);
	const layout = saved && activePaneId ? setActivePane(saved, activePaneId) : saved;
	const shown = new Set(layout?.groups.map((group) => group.activePaneId));
	if (activePaneId) shown.add(activePaneId);
	for (const window of windows ? paneWindows(windows) : []) {
		if (window.workSessionId === workSessionId && !window.hidden) shown.add(window.paneId);
	}
	return shown;
}
