import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import {
	findPaneGroup,
	flattenPanes,
	movePane,
	serializeLayout,
	type DropPosition,
	type PaneKind as LayoutKind,
	type PaneLayout,
} from "@kilo-desktop/pane-layout";

import {
	EMPTY_WORK_SESSION_PANES,
	type Pane,
	type PaneArrangement,
	type PaneImplementation,
	type Panes,
	type WorkSessionPanes,
} from "../../contracts";
import type { Track } from "./telemetry";
import { sessionLayout } from "./session-layout";

export type PanesHandle = DomainObjectHandle<typeof Panes>;

/** Where a launched pane goes: its own column (default), a group's tabs, or beside the active group. */
export type PanePlacement =
	| { readonly into: string }
	| { readonly beside: "after" | "below" }
	| undefined;

export function sessionPanesOf(panes: PanesHandle, workSessionId: string): WorkSessionPanes {
	return panes.getState().byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES;
}

export function saveLayout(
	panes: PanesHandle,
	workSessionId: string,
	layout: PaneLayout,
): Promise<void> {
	return panes.methods.setLayout({
		workSessionId,
		layout: serializeLayout(layout),
		activePaneId: layout.activePaneId,
	});
}

/** A launched pane, and whether it is new (a singleton kind's existing pane is shown instead). */
export interface LaunchedPane {
	readonly pane: Pane;
	readonly opened: boolean;
}

/**
 * Opens a pane of `kind` and places it; the layout is saved only when
 * placement moves it. Main reports the pane as opened.
 */
export async function launchPane(
	panes: PanesHandle,
	workSessionId: string,
	kind: string,
	layoutKindOf: (kind: string) => LayoutKind,
	placement?: PanePlacement,
): Promise<LaunchedPane> {
	const before = sessionPanesOf(panes, workSessionId);
	const anchor = sessionLayout(before, layoutKindOf);
	const anchorGroup = anchor.activePaneId ? findPaneGroup(anchor, anchor.activePaneId) : undefined;
	const pane = await panes.methods.open({ workSessionId, kind });
	const opened = !before.panes.some((existing) => existing.id === pane.id);
	if (!placement || !opened) return { pane, opened };
	const target = "into" in placement ? placement.into : anchorGroup?.id;
	if (!target) return { pane, opened };
	const position: DropPosition = "into" in placement ? "inside" : placement.beside;
	const layout = sessionLayout(
		{ ...before, panes: [...before.panes, pane], activePaneId: pane.id },
		layoutKindOf,
	);
	await saveLayout(panes, workSessionId, movePane(layout, pane.id, target, position));
	return { pane, opened };
}

/** Panes in the order their tabs show, left to right and top to bottom. */
export function panesInOrder(layout: PaneLayout): string[] {
	return flattenPanes(layout).map((pane) => pane.id);
}

/**
 * Closes a pane a person closed once its kind's `canClose` agrees (unsaved
 * changes); false when the person kept it. A guard that fails lets it close,
 * so a broken plugin can't trap a pane open. Main reports it as closed.
 */
export async function closePane(
	panes: PanesHandle,
	workSessionId: string,
	paneId: string,
	implementationOf: (kind: string) => PaneImplementation | undefined,
): Promise<boolean> {
	const pane = sessionPanesOf(panes, workSessionId).panes.find(
		(candidate) => candidate.id === paneId,
	);
	if (!pane) return false;
	const canClose = implementationOf(pane.kind)?.canClose;
	if (canClose && !(await canClose({ workSessionId, pane }).catch(() => true))) return false;
	const { closed } = await panes.methods.close({ workSessionId, paneId });
	return closed;
}

/** Changes a work session's arrangement as a person asked, reporting it. */
export async function setArrangement(
	panes: PanesHandle,
	workSessionId: string,
	arrangement: PaneArrangement,
	track: Track,
): Promise<void> {
	await panes.methods.setArrangement({ workSessionId, arrangement });
	track("layout-arrangement-changed", { arrangement });
}
