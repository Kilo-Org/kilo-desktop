import {
	KernelClipboard,
	KernelCommand,
	KernelWindows,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import type { PaneKind as LayoutKind } from "@kilo-desktop/pane-layout";

import {
	PaneKind,
	Panes,
	paneWindows,
	WorkSessionsWindow,
	type Pane,
	type PaneImplementation,
	type WorkSessionPanes,
} from "../../contracts";
import { paneMoves } from "../canvas/pane-moves";
import { visibleWorkSessions } from "../shared/list-state";
import { adjacentId, idAtShortcutSlot, NUMBERED_SLOTS } from "../shared/numbered";
import {
	closePane,
	closePanes,
	launchPane,
	panesInOrder,
	panesToClose,
	tabsToClose,
	sessionPanesOf,
	setArrangement,
	type CloseScope,
} from "../shared/pane-actions";
import { foldersOfWorkSession, paneFilePath, relativePanePath } from "../shared/pane-path";
import { notify, reportFailure } from "../shared/report-failure";
import { sessionLayout } from "../shared/session-layout";
import { trackerFor } from "../shared/telemetry";
import { panePicker } from "../panes/pane-picker";
import { popOut } from "../panes/pop-outs";

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

/** The pane a tab command names (`{ paneId }`), else the active one; undefined when it isn't open. */
function targetPane(state: WorkSessionPanes, args: unknown): Pane | undefined {
	const named = (args as { paneId?: unknown } | undefined)?.paneId;
	const paneId = typeof named === "string" ? named : state.activePaneId;
	return state.panes.find((pane) => pane.id === paneId);
}

/**
 * The open tabs of the group the tab strip shows `paneId` in (`{ groupPaneIds }`,
 * from the tab menu); undefined without one holding it. The strip can show a
 * layout not saved yet, and the menu should act on what the person sees.
 */
function shownGroup(state: WorkSessionPanes, paneId: string, args: unknown): string[] | undefined {
	const ids = (args as { groupPaneIds?: unknown } | undefined)?.groupPaneIds;
	if (!Array.isArray(ids) || !ids.includes(paneId)) return undefined;
	const open = new Set(state.panes.map((pane) => pane.id));
	return ids.filter((id): id is string => typeof id === "string" && open.has(id));
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
		return { workSessionId, panes, state, layout, order: panesInOrder(layout) };
	};
	/** The open work session and the pane a tab command acts on; null when either is missing. */
	const target = (args: unknown) => {
		const session = current();
		const pane = session && targetPane(session.state, args);
		return session && pane ? { session, pane } : null;
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
	command("close-pane", (args) => {
		const { session, pane } = target(args) ?? {};
		if (!session || !pane) return;
		void closePane(session.panes, session.workSessionId, pane.id, (kind) =>
			implementationOf(sdk, kind),
		).catch(() => undefined);
	});
	const closeGroup = (scope: CloseScope) => (args?: unknown) => {
		const { session, pane } = target(args) ?? {};
		if (!session || !pane) return;
		// Taken before the first close: each close changes the layout.
		const shown = shownGroup(session.state, pane.id, args);
		const paneIds = shown
			? tabsToClose(shown, pane.id, scope)
			: panesToClose(session.layout, pane.id, scope);
		void closePanes(session.panes, session.workSessionId, paneIds, (kind) =>
			implementationOf(sdk, kind),
		).then((failed) => {
			if (failed === 0) return;
			notify({
				level: "error",
				title: `Could not close ${failed} ${failed === 1 ? "tab" : "tabs"}`,
				description: "The others closed.",
			});
		});
	};
	command("close-other-panes", closeGroup("others"));
	command("close-panes-to-the-right", closeGroup("right"));
	command("close-all-panes", closeGroup("all"));
	const copyPath = (relative: boolean) => (args?: unknown) => {
		const { session, pane } = target(args) ?? {};
		const path = pane && paneFilePath(pane, implementationOf(sdk, pane.kind));
		if (!session || !path) return;
		const text = relative
			? relativePanePath(path, foldersOfWorkSession(sdk, session.workSessionId))
			: path;
		const clipboard = sdk.domainObjects.get(KernelClipboard);
		// Inside `then`, so a missing navigator.clipboard (a sync throw) is reported too.
		void Promise.resolve()
			.then(() =>
				clipboard
					? clipboard.methods.writeText({ text })
					: globalThis.navigator.clipboard.writeText(text),
			)
			.catch(reportFailure("Could not copy the path", "The clipboard isn't available."));
	};
	command("copy-pane-path", copyPath(false));
	command("copy-pane-relative-path", copyPath(true));
	for (const direction of ["up", "down", "left", "right"] as const) {
		command(`move-pane-${direction}`, (args) => {
			const { session, pane } = target(args) ?? {};
			if (session && pane) {
				paneMoves.request({ workSessionId: session.workSessionId, paneId: pane.id, direction });
			}
		});
	}
	command("move-pane-to-new-window", (args) => {
		const { session, pane } = target(args) ?? {};
		const windows = sdk.context.get("kernel/desktop") ? sdk.domainObjects.get(KernelWindows) : null;
		if (!session || !pane || !windows) return;
		const window = paneWindows(windows.getState()).find(
			(candidate) =>
				candidate.workSessionId === session.workSessionId && candidate.paneId === pane.id,
		);
		void (
			window
				? windows.methods.focus({ windowId: window.windowId })
				: popOut(windows, session.workSessionId, pane)
		).catch(reportFailure("Could not move the tab into a new window", "Nothing changed."));
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
 * or, when it has none, opens one as a tab of the active group (as from ⌘T)
 * or in a new group beside it (as from the header "+").
 */
export async function openOrShowPane(
	sdk: PluginSdk,
	workSessionId: string,
	kind: string,
	placement: "tab" | "group" = "tab",
): Promise<void> {
	const panes = sdk.domainObjects.get(Panes);
	if (!panes) return;
	const existing = sessionPanesOf(panes, workSessionId).panes.findLast(
		(pane) => pane.kind === kind,
	);
	if (!existing) {
		await launchPane(
			panes,
			workSessionId,
			kind,
			(paneKind) => layoutKindOf(sdk, paneKind),
			placement === "group" ? { beside: "after" } : undefined,
		);
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
