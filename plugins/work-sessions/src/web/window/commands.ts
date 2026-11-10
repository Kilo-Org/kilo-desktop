import { KernelCommand, KernelWindows, type PluginSdk } from "@kilo-desktop/kernel";
import type { PaneKind as LayoutKind } from "@kilo-desktop/pane-layout";

import { PaneKind, Panes, WorkSessionsWindow, type PaneImplementation } from "../../contracts";
import { visibleWorkSessions } from "../shared/list-state";
import { adjacentId, idAtShortcutSlot, NUMBERED_SLOTS } from "../shared/numbered";
import {
	closePane,
	launchPane,
	panesInOrder,
	sessionPanesOf,
	setArrangement,
} from "../shared/pane-actions";
import { sessionLayout } from "../shared/session-layout";
import { trackerFor } from "../shared/telemetry";
import { panePicker } from "../panes/pane-picker";
import { paneWindows } from "../panes/pop-outs";

type Command = (id: string, handler: (args?: unknown) => void) => void;

const commandOf =
	(sdk: PluginSdk): Command =>
	(id, handler) =>
		sdk.extensions.implement(KernelCommand, id, handler);

function openWorkSession(sdk: PluginSdk, workSessionId: string): void {
	void sdk.domainObjects
		.get(WorkSessionsWindow)
		?.methods.openWorkSession({ workSessionId })
		.catch(() => undefined);
}

/**
 * Moving between work sessions in the order the session list shows them
 * (next / previous, ⌃1–8, last), and opening a work session or a work
 * sessions view by id (run from other windows and plugins).
 */
export function implementWorkSessionCommands(
	sdk: PluginSdk,
	showInPlace: (view: string) => void,
): void {
	const command = commandOf(sdk);
	const activeId = () =>
		sdk.domainObjects.get(WorkSessionsWindow)?.getState().activeWorkSessionId ?? undefined;
	const step = (delta: 1 | -1) => {
		const workSessionId = adjacentId(visibleWorkSessions.get(), activeId(), delta);
		if (workSessionId) openWorkSession(sdk, workSessionId);
	};
	command("next-work-session", () => step(1));
	command("previous-work-session", () => step(-1));
	for (const slot of NUMBERED_SLOTS) {
		command(slot === 9 ? "work-session-last" : `work-session-${slot}`, () => {
			const workSessionId = idAtShortcutSlot(visibleWorkSessions.get(), slot);
			if (workSessionId) openWorkSession(sdk, workSessionId);
		});
	}
	command("open-work-session", (args) => {
		const workSessionId = (args as { workSessionId?: unknown } | undefined)?.workSessionId;
		if (typeof workSessionId === "string") openWorkSession(sdk, workSessionId);
	});
	command("show-work-sessions-view", (args) => {
		const view = (args as { view?: unknown } | undefined)?.view;
		if (typeof view === "string") showInPlace(view);
	});
}

export function layoutKindOf(sdk: PluginSdk, kind: string): LayoutKind {
	return (
		sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)?.metadata
			.layoutKind ?? "tool"
	);
}

function implementationOf(sdk: PluginSdk, kind: string): PaneImplementation | undefined {
	return sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)
		?.implementation as PaneImplementation | undefined;
}

/** Tab commands act on the panes of this window's open work session. */
export function implementPaneCommands(sdk: PluginSdk): void {
	const command = commandOf(sdk);
	const track = trackerFor(sdk);
	const current = () => {
		const workSessionId = sdk.domainObjects.get(WorkSessionsWindow)?.getState().activeWorkSessionId;
		const panes = sdk.domainObjects.get(Panes);
		if (!workSessionId || !panes) return null;
		const state = sessionPanesOf(panes, workSessionId);
		const layout = sessionLayout(state, (kind) => layoutKindOf(sdk, kind));
		return { workSessionId, panes, state, order: panesInOrder(layout) };
	};
	const show = (pick: (order: string[], activeId: string | null) => string | undefined) => {
		const session = current();
		const paneId = session && pick(session.order, session.state.activePaneId);
		if (!session || !paneId) return;
		void session.panes.methods
			.activate({ workSessionId: session.workSessionId, paneId })
			.catch(() => undefined);
	};

	command("new-pane", () => panePicker.open({ placement: undefined, title: "New tab" }));
	command("new-group-right", () =>
		panePicker.open({ placement: { beside: "after" }, title: "New group" }),
	);
	command("new-group-below", () =>
		panePicker.open({ placement: { beside: "below" }, title: "New group" }),
	);
	command("close-pane", () => {
		const session = current();
		const paneId = session?.state.activePaneId;
		if (!session || !paneId) return;
		void closePane(session.panes, session.workSessionId, paneId, (kind) =>
			implementationOf(sdk, kind),
		).catch(() => undefined);
	});
	command("next-pane", () => show((order, active) => adjacentId(order, active ?? undefined, 1)));
	command("previous-pane", () =>
		show((order, active) => adjacentId(order, active ?? undefined, -1)),
	);
	command("toggle-carousel", () => {
		const session = current();
		if (!session) return;
		void setArrangement(
			session.panes,
			session.workSessionId,
			session.state.arrangement === "carousel" ? "tiles" : "carousel",
			track,
		).catch(() => undefined);
	});
	for (const slot of NUMBERED_SLOTS) {
		command(slot === 9 ? "pane-last" : `pane-${slot}`, () =>
			show((order) => idAtShortcutSlot(order, slot)),
		);
	}
}

/**
 * Shows the work session's last pane of `kind` — its window when popped out —
 * or, when it has none, opens one as if picked from "+".
 */
export async function openOrShowPane(
	sdk: PluginSdk,
	workSessionId: string,
	kind: string,
): Promise<void> {
	const panes = sdk.domainObjects.get(Panes);
	if (!panes) return;
	const existing = sessionPanesOf(panes, workSessionId).panes.findLast(
		(pane) => pane.kind === kind,
	);
	if (!existing) {
		await launchPane(panes, workSessionId, kind, (paneKind) => layoutKindOf(sdk, paneKind));
		return;
	}
	const windows = sdk.domainObjects.get(KernelWindows);
	const popOut = windows
		? paneWindows(windows.getState()).find(
				(window) => window.workSessionId === workSessionId && window.paneId === existing.id,
			)
		: undefined;
	if (windows && popOut) await windows.methods.focus({ windowId: popOut.windowId });
	else await panes.methods.activate({ workSessionId, paneId: existing.id });
}
