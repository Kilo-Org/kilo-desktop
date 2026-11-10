import {
	KernelWindows,
	type DomainObjectProvider,
	type DomainObjectState,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import {
	UNSCOPED_WORKSPACE_FOCUS,
	WorkSessions,
	WorkSessionsWindow,
	type WorkSessionsWindowState,
} from "../../contracts";
import { matchesWorkspaceFocus } from "../shared/workspace-focus";
import { detachedViewWindows } from "../views/view-windows";
import { readSavedWindow, writeSavedWindow } from "./saved-window";

export interface WindowControls {
	readonly provider: DomainObjectProvider<typeof WorkSessionsWindow>;
	/** Shows a view in place even while its window is still closing (docking). */
	showInPlace(view: string): void;
}

export interface WindowOptions {
	/** Shows or opens a pane of the kind in the open work session (see `WorkSessionsWindow.openPane`). */
	readonly openPane: (workSessionId: string, kind: string) => Promise<void>;
	/** With no work session open: starts one from the New Session page with a pane of the kind. */
	readonly startWithPane: (kind: string) => void;
}

/**
 * The window's `WorkSessionsWindow`: what it is looking at, remembered per
 * window in localStorage. Opening or closing a work session, or showing a
 * work sessions view, also brings the window back to the home view. Opening
 * a work session the list's workspace focus hides (one started in another
 * workspace from the New Session page, or found by search) moves the focus to
 * its workspace, so the open work session is always in the list. A
 * remembered work session that no longer exists is let go once work sessions
 * load; `detachedViews` follows the work sessions view windows open on
 * `kernel/windows`; `workSessionActive` / `workspaceActive` /
 * `paneTargetActive` follow the state (a work session behind a work sessions
 * view is not active).
 */
export function provideWorkSessionsWindow(sdk: PluginSdk, options: WindowOptions): WindowControls {
	const windowId = sdk.windowId ?? "main";
	const provider: DomainObjectProvider<typeof WorkSessionsWindow> = sdk.domainObjects.provide(
		WorkSessionsWindow,
		{
			initialState: { ...readSavedWindow(windowId), detachedViews: [] },
			methods: {
				setFocus: ({ focus }) => update({ focus }),
				openWorkSession: ({ workSessionId }) => {
					update({ activeWorkSessionId: workSessionId, view: null, ...revealing(workSessionId) });
					goHome();
				},
				closeWorkSession: () => {
					update({ activeWorkSessionId: null, view: null });
					goHome();
				},
				showView: ({ view }) => {
					const windowOfView = view && detachedWindowId(view);
					if (windowOfView) {
						void sdk.domainObjects
							.get(KernelWindows)
							?.methods.focus({ windowId: windowOfView })
							.catch(() => undefined);
						return;
					}
					update({ view });
					goHome();
				},
				openPane: async ({ kind }) => {
					const workSessionId = provider.state.activeWorkSessionId;
					if (workSessionId) await options.openPane(workSessionId, kind);
					else options.startWithPane(kind);
				},
			},
		},
	);

	/** The focus that shows `workSessionId` in the list, when the current one hides it. */
	function revealing(workSessionId: string): Partial<WorkSessionsWindowState> {
		const { focus } = provider.state;
		const workSession = sdk.domainObjects
			.get(WorkSessions)
			?.getState()
			.workSessions.find((candidate) => candidate.id === workSessionId);
		if (!workSession || matchesWorkspaceFocus(workSession.workspaceId, focus)) return {};
		return { focus: workSession.workspaceId ?? UNSCOPED_WORKSPACE_FOCUS };
	}

	function detachedWindowId(view: string): string | null {
		const windows = sdk.domainObjects.get(KernelWindows)?.getState();
		return (
			(windows && detachedViewWindows(windows).find((entry) => entry.view === view)?.windowId) ??
			null
		);
	}
	function goHome(): void {
		void sdk.domainObjects
			.get(Navigation)
			?.methods.goHome({})
			.catch(() => undefined);
	}
	function update(patch: Partial<WorkSessionsWindowState>): void {
		const next = { ...provider.state, ...patch };
		provider.setState(next);
		writeSavedWindow(windowId, {
			focus: next.focus,
			activeWorkSessionId: next.activeWorkSessionId,
			view: next.view,
		});
		publishKeys(next);
	}
	function publishKeys(state: WorkSessionsWindowState): void {
		sdk.context.set("workSessionActive", state.activeWorkSessionId !== null && state.view === null);
		// With no work session open and no work sessions view, the window shows the New Session page.
		sdk.context.set("paneTargetActive", state.view === null);
		sdk.context.set("workspaceActive", state.focus !== null);
	}
	publishKeys(provider.state);

	const stops: (() => void)[] = [];
	sdk.domainObjects.track(WorkSessions, {
		added(workSessions) {
			const forgetMissing = ({ workSessions: list }: DomainObjectState<typeof WorkSessions>) => {
				const active = provider.state.activeWorkSessionId;
				if (active && !list.some((workSession) => workSession.id === active)) {
					update({ activeWorkSessionId: null });
				}
			};
			forgetMissing(workSessions.getState());
			stops.push(workSessions.subscribe(forgetMissing));
		},
		removed() {},
	});
	sdk.domainObjects.track(KernelWindows, {
		added(windows) {
			const follow = (state: DomainObjectState<typeof KernelWindows>) => {
				const views = detachedViewWindows(state).map((entry) => entry.view);
				const current = provider.state.detachedViews;
				if (views.length === current.length && views.every((view, i) => view === current[i])) {
					return;
				}
				provider.setState({ ...provider.state, detachedViews: views });
			};
			follow(windows.getState());
			stops.push(windows.subscribe(follow));
		},
		removed() {
			if (provider.state.detachedViews.length > 0) {
				provider.setState({ ...provider.state, detachedViews: [] });
			}
		},
	});
	sdk.onDispose(() => {
		for (const stop of stops.splice(0)) stop();
	});
	return {
		provider,
		showInPlace(view) {
			update({ view });
			goHome();
		},
	};
}
