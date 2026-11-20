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
	WorkSessionsView,
	WorkSessionsWindow,
	type WorkSessionsWindowState,
} from "../../contracts";
import { requestLauncherFocus } from "../home/launcher-focus";
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
	readonly openPane: (
		workSessionId: string,
		kind: string,
		placement: "tab" | "group" | undefined,
	) => Promise<void>;
	/** With no work session open: starts one from the New Session page with a pane of the kind. */
	readonly startWithPane: (kind: string) => void;
}

/**
 * The window's `WorkSessionsWindow`: what it is looking at. Only the
 * workspace focus is remembered (per window, in localStorage); every launch
 * opens on the New Session page with no work session or view shown. Opening
 * or closing a work session, or showing a work sessions view, also brings the
 * window back to the home view. Opening a work session the list's workspace
 * focus hides (one started in another workspace from the New Session page, or
 * found by search) moves the focus to its workspace, so the open work session
 * is always in the list. An open work session deleted elsewhere is let go;
 * `detachedViews` follows the work sessions view windows open on
 * `kernel/windows`; `workSessionActive` / `workSessionsViewShown` /
 * `workspaceActive` / `paneTargetActive` follow what the window shows (a work
 * session behind a work sessions view is not active). A view no plugin
 * contributes (its plugin is off, or not activated yet) shows nothing, as in
 * `WorkSessionsMain`, so the keys treat it as absent without forgetting it.
 */
export function provideWorkSessionsWindow(sdk: PluginSdk, options: WindowOptions): WindowControls {
	const windowId = sdk.windowId ?? "main";
	const provider: DomainObjectProvider<typeof WorkSessionsWindow> = sdk.domainObjects.provide(
		WorkSessionsWindow,
		{
			initialState: {
				...readSavedWindow(windowId),
				activeWorkSessionId: null,
				view: null,
				detachedViews: [],
			},
			methods: {
				setFocus: ({ focus }) => update({ focus }),
				openWorkSession: ({ workSessionId }) => {
					update({ activeWorkSessionId: workSessionId, view: null, ...revealing(workSessionId) });
					goHome();
				},
				closeWorkSession: () => {
					update({ activeWorkSessionId: null, view: null });
					goHome();
					requestLauncherFocus();
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
				openPane: async ({ kind, placement }) => {
					const workSessionId = provider.state.activeWorkSessionId;
					if (workSessionId) await options.openPane(workSessionId, kind, placement);
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
		writeSavedWindow(windowId, { focus: next.focus });
		publishKeys(next);
	}
	function viewShown(view: string | null): boolean {
		return view !== null && sdk.extensions.list(WorkSessionsView).some(({ key }) => key === view);
	}
	function publishKeys(state: WorkSessionsWindowState): void {
		const shown = viewShown(state.view);
		sdk.context.set("workSessionActive", state.activeWorkSessionId !== null && !shown);
		sdk.context.set("workSessionsViewShown", shown);
		// With no work session open and no work sessions view, the window shows the New Session page.
		sdk.context.set("paneTargetActive", !shown);
		sdk.context.set("workspaceActive", state.focus !== null);
	}
	publishKeys(provider.state);

	const stops: (() => void)[] = [
		sdk.extensions.subscribe(WorkSessionsView, () => publishKeys(provider.state)),
	];
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
