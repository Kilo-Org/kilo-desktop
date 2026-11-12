import { useCallback } from "react";

import {
	KernelWindows,
	type DomainObjectHandle,
	type DomainObjectState,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";

import {
	PANE_WINDOW_VIEW,
	Panes,
	paneWindows,
	WorkSessionsWindow,
	type Pane,
	type PaneWindow,
} from "../../contracts";

type WindowsState = DomainObjectState<typeof KernelWindows>;

const NO_POP_OUTS: ReadonlyMap<string, string> = new Map();

/** The work session's popped-out panes: pane id → window id. */
export function usePoppedOutPanes(workSessionId: string): ReadonlyMap<string, string> {
	const select = useCallback(
		(state: WindowsState) => {
			const entries = paneWindows(state)
				.filter((window) => window.workSessionId === workSessionId)
				.map((window) => `${window.paneId}\n${window.windowId}`);
			return entries.join("\t");
		},
		[workSessionId],
	);
	const serialized = useDomainObjectState(KernelWindows, select);
	if (!serialized) return NO_POP_OUTS;
	return new Map(serialized.split("\t").map((entry) => entry.split("\n") as [string, string]));
}

/** Opens a pane in its own window, or shows the window it already has. */
export function popOut(
	windows: DomainObjectHandle<typeof KernelWindows>,
	workSessionId: string,
	pane: Pane,
): Promise<unknown> {
	return windows.methods.open({
		view: PANE_WINDOW_VIEW,
		key: `${workSessionId}/${pane.id}`,
		title: pane.title,
		params: { workSessionId, paneId: pane.id },
	});
}

/**
 * Keeps this (main) window's pop-outs in step: only the open work session's
 * are shown, a pop-out whose pane closed or whose work session went away
 * closes, and a pane whose window closes (docked) becomes its work session's
 * active pane.
 */
export function reconcilePopOuts(sdk: PluginSdk): () => void {
	const known = new Map<string, PaneWindow>();
	const stops: (() => void)[] = [];
	const reconcile = () => {
		const windows = sdk.domainObjects.get(KernelWindows);
		if (!windows) return;
		const activeWorkSessionId =
			sdk.domainObjects.get(WorkSessionsWindow)?.getState().activeWorkSessionId ?? null;
		const byWorkSession = sdk.domainObjects.get(Panes)?.getState().byWorkSession;
		const current = paneWindows(windows.getState());
		// Kept until the window's `closed` event, which follows the state that drops it.
		for (const window of current) known.set(window.windowId, window);
		for (const window of current) {
			const paneExists =
				byWorkSession === undefined ||
				byWorkSession[window.workSessionId]?.panes.some((pane) => pane.id === window.paneId);
			if (!paneExists) {
				void windows.methods.close({ windowId: window.windowId }).catch(() => undefined);
				continue;
			}
			const hidden = window.workSessionId !== activeWorkSessionId;
			if (hidden !== window.hidden) {
				void windows.methods
					.setHidden({ windowId: window.windowId, hidden })
					.catch(() => undefined);
			}
		}
	};
	const follow = (handle: { subscribe(listener: () => void): () => void }) => {
		stops.push(handle.subscribe(reconcile));
		reconcile();
	};
	const track = (domain: typeof KernelWindows | typeof WorkSessionsWindow | typeof Panes) =>
		sdk.domainObjects.track(domain as typeof Panes, {
			added: (handle) => follow(handle),
			removed: () => undefined,
		});
	stops.push(track(KernelWindows), track(WorkSessionsWindow), track(Panes));
	stops.push(
		sdk.domainObjects.track(KernelWindows, {
			added: (windows) =>
				stops.push(
					windows.on("closed", ({ windowId }) => {
						const docked = known.get(windowId);
						known.delete(windowId);
						if (!docked) return;
						void sdk.domainObjects
							.get(Panes)
							?.methods.activate({ workSessionId: docked.workSessionId, paneId: docked.paneId })
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
