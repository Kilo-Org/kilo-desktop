import type { DomainHandle } from "@kilo-desktop/kernel";
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
	EMPTY_SESSION_PANES,
	type PaneArrangement,
	type Pane,
	type PaneImplementation,
	type Panes,
	type SessionPanes,
} from "@kilo-desktop/plugin-sessions/contracts";

import { paneTypeOf, type TrackWorkbench } from "../telemetry";
import { sessionLayout } from "./session-layout";

export type PanesHandle = DomainHandle<typeof Panes>;

/** Where a launched pane goes: its own column (default), a group's tabs, or beside the active group. */
export type PanePlacement =
	| { readonly into: string }
	| { readonly beside: "after" | "below" }
	| undefined;

export function sessionPanesOf(panes: PanesHandle, sessionId: string): SessionPanes {
	return panes.getState().bySession[sessionId] ?? EMPTY_SESSION_PANES;
}

export function saveLayout(
	panes: PanesHandle,
	sessionId: string,
	layout: PaneLayout,
): Promise<void> {
	return panes.methods.setLayout({
		sessionId,
		layout: serializeLayout(layout),
		activePaneId: layout.activePaneId,
	});
}

/** A launched pane, and whether it is new (a singleton kind's existing pane is shown instead). */
export interface LaunchedPane {
	readonly pane: Pane;
	readonly opened: boolean;
}

/** Opens a pane of `kind` and places it; the layout is saved only when placement moves it. */
export async function launchPane(
	panes: PanesHandle,
	sessionId: string,
	kind: string,
	layoutKindOf: (kind: string) => LayoutKind,
	placement?: PanePlacement,
): Promise<LaunchedPane> {
	const before = sessionPanesOf(panes, sessionId);
	const anchor = sessionLayout(before, layoutKindOf);
	const anchorGroup = anchor.activePaneId ? findPaneGroup(anchor, anchor.activePaneId) : undefined;
	const pane = await panes.methods.open({ sessionId, kind });
	const opened = !before.panes.some((existing) => existing.id === pane.id);
	if (!placement || !opened) return { pane, opened };
	const target = "into" in placement ? placement.into : anchorGroup?.id;
	if (!target) return { pane, opened };
	const position: DropPosition = "into" in placement ? "inside" : placement.beside;
	const layout = sessionLayout(
		{ ...before, panes: [...before.panes, pane], activePaneId: pane.id },
		layoutKindOf,
	);
	await saveLayout(panes, sessionId, movePane(layout, pane.id, target, position));
	return { pane, opened };
}

/** Launches a pane a person asked for, reporting it as "Pane Opened" when a new one opened. */
export async function launchPaneForPerson(
	track: TrackWorkbench,
	...args: Parameters<typeof launchPane>
): Promise<LaunchedPane> {
	const launched = await launchPane(...args);
	if (launched.opened) track("Pane Opened", { paneType: paneTypeOf(launched.pane.kind) });
	return launched;
}

/** Panes in the order their tabs show, left to right and top to bottom. */
export function panesInOrder(layout: PaneLayout): string[] {
	return flattenPanes(layout).map((pane) => pane.id);
}

/**
 * Closes a pane a person closed once its kind's `canClose` agrees (unsaved
 * changes), reporting it as "Pane Closed"; false when the person kept it. A
 * guard that fails lets it close, so a broken plugin can't trap a pane open.
 */
export async function closePane(
	panes: PanesHandle,
	sessionId: string,
	paneId: string,
	implementationOf: (kind: string) => PaneImplementation | undefined,
	track: TrackWorkbench,
): Promise<boolean> {
	const pane = sessionPanesOf(panes, sessionId).panes.find((candidate) => candidate.id === paneId);
	if (!pane) return false;
	const canClose = implementationOf(pane.kind)?.canClose;
	if (canClose && !(await canClose({ sessionId, pane }).catch(() => true))) return false;
	const { closed } = await panes.methods.close({ sessionId, paneId });
	if (closed) track("Pane Closed", { paneType: paneTypeOf(pane.kind) });
	return closed;
}

/** Changes a session's arrangement as a person asked, reporting it. */
export async function setArrangement(
	panes: PanesHandle,
	sessionId: string,
	arrangement: PaneArrangement,
	track: TrackWorkbench,
): Promise<void> {
	await panes.methods.setArrangement({ sessionId, arrangement });
	track("Layout Arrangement Changed", { arrangement });
}
