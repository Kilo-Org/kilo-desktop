import { useCallback } from "react";

import { KernelWindows, type DomainHandle, type PluginSdk } from "@kilo-desktop/kernel";
import { useDomainState } from "@kilo-desktop/kernel/web";
import { Panes, type Pane } from "@kilo-desktop/plugin-sessions/contracts";

import { Navigator } from "../../contracts";

/** The window view a popped-out pane opens in. */
export const PANE_WINDOW_VIEW = "kilo.workbench/pane";

type WindowsState = DomainHandle<typeof KernelWindows> extends { getState(): infer S } ? S : never;
type WindowRecord = WindowsState["windows"][string];

export interface PaneWindow {
	readonly windowId: string;
	readonly sessionId: string;
	readonly paneId: string;
	readonly hidden: boolean;
}

function paneWindowOf(windowId: string, window: WindowRecord): PaneWindow | null {
	const { sessionId, paneId } = window.params;
	if (window.view !== PANE_WINDOW_VIEW || !sessionId || !paneId) return null;
	return { windowId, sessionId, paneId, hidden: window.hidden };
}

export function paneWindows(state: WindowsState): PaneWindow[] {
	return Object.entries(state.windows).flatMap(([windowId, window]) => {
		const paneWindow = paneWindowOf(windowId, window);
		return paneWindow ? [paneWindow] : [];
	});
}

const NO_POP_OUTS: ReadonlyMap<string, string> = new Map();

/** The session's popped-out panes: pane id → window id. */
export function usePoppedOutPanes(sessionId: string): ReadonlyMap<string, string> {
	const select = useCallback(
		(state: WindowsState) => {
			const entries = paneWindows(state)
				.filter((window) => window.sessionId === sessionId)
				.map((window) => `${window.paneId}\n${window.windowId}`);
			return entries.join("\t");
		},
		[sessionId],
	);
	const serialized = useDomainState(KernelWindows, select);
	if (!serialized) return NO_POP_OUTS;
	return new Map(serialized.split("\t").map((entry) => entry.split("\n") as [string, string]));
}

/** Opens a pane in its own window, or shows the window it already has. */
export function popOut(
	windows: DomainHandle<typeof KernelWindows>,
	sessionId: string,
	pane: Pane,
): Promise<unknown> {
	return windows.methods.open({
		view: PANE_WINDOW_VIEW,
		key: `${sessionId}/${pane.id}`,
		title: pane.title,
		params: { sessionId, paneId: pane.id },
	});
}

/**
 * Keeps this (main) window's pop-outs in step: only the open session's are
 * shown, a pop-out whose pane closed or whose session went away closes, and
 * a pane whose window closes (docked) becomes its session's active pane.
 */
export function reconcilePopOuts(sdk: PluginSdk): () => void {
	const known = new Map<string, PaneWindow>();
	const stops: (() => void)[] = [];
	const reconcile = () => {
		const windows = sdk.domains.get(KernelWindows);
		if (!windows) return;
		const activeSessionId = sdk.domains.get(Navigator)?.getState().activeSessionId ?? null;
		const bySession = sdk.domains.get(Panes)?.getState().bySession;
		const current = paneWindows(windows.getState());
		// Kept until the window's `closed` event, which follows the state that drops it.
		for (const window of current) known.set(window.windowId, window);
		for (const window of current) {
			const paneExists =
				bySession === undefined ||
				bySession[window.sessionId]?.panes.some((pane) => pane.id === window.paneId);
			if (!paneExists) {
				void windows.methods.close({ windowId: window.windowId }).catch(() => undefined);
				continue;
			}
			const hidden = window.sessionId !== activeSessionId;
			if (hidden !== window.hidden) {
				void windows.methods
					.setHidden({ windowId: window.windowId, hidden })
					.catch(() => undefined);
			}
		}
	};
	const follow = <T extends { subscribe(listener: () => void): () => void }>(handle: T) => {
		stops.push(handle.subscribe(reconcile));
		reconcile();
	};
	const track = (domain: typeof KernelWindows | typeof Navigator | typeof Panes) =>
		sdk.domains.track(domain as typeof Panes, {
			added: (handle) => follow(handle),
			removed: () => undefined,
		});
	stops.push(track(KernelWindows), track(Navigator), track(Panes));
	stops.push(
		sdk.domains.track(KernelWindows, {
			added: (windows) =>
				stops.push(
					windows.on("closed", ({ windowId }) => {
						const docked = known.get(windowId);
						known.delete(windowId);
						if (!docked) return;
						void sdk.domains
							.get(Panes)
							?.methods.activate({ sessionId: docked.sessionId, paneId: docked.paneId })
							.catch(() => undefined);
					}),
				),
			removed: () => undefined,
		}),
	);
	return () => {
		for (const stop of stops.splice(0)) stop();
	};
}
