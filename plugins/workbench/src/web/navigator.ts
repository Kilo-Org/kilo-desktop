import { KernelWindows, type DomainProvider, type PluginSdk } from "@kilo-desktop/kernel";
import { Sessions } from "@kilo-desktop/plugin-sessions/contracts";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import { Navigator, type NavigatorState } from "../contracts";
import { readSessionListView } from "./list/session-list-view";
import { detachedViewWindows } from "./views/view-windows";

type SavedState = Pick<NavigatorState, "focus" | "activeSessionId" | "view">;

export const navigatorStorageKey = (windowId: string) => `kilo.workbench.navigator:${windowId}`;

/** A window's saved state; a first run adopts origin's session-list workspace filter. */
export function readSavedNavigator(windowId: string, adoptOrigin = true): SavedState {
	try {
		const raw = localStorage.getItem(navigatorStorageKey(windowId));
		if (raw === null) {
			return {
				focus: adoptOrigin ? readSessionListView().focus : null,
				activeSessionId: null,
				view: null,
			};
		}
		const record = (JSON.parse(raw) ?? {}) as Partial<NavigatorState>;
		const text = (value: unknown) => (typeof value === "string" ? value : null);
		return {
			focus: text(record.focus),
			activeSessionId: text(record.activeSessionId),
			view: text(record.view),
		};
	} catch {
		return { focus: null, activeSessionId: null, view: null };
	}
}

export interface NavigatorControls {
	readonly navigator: DomainProvider<typeof Navigator>;
	/** Shows a view in place even while its window is still closing (docking). */
	showInPlace(view: string): void;
}

/**
 * What this window is looking at, remembered per window in localStorage.
 * Opening or closing a session, or showing a sessions view, also brings the
 * window back to the home view. A remembered session that no longer exists
 * is let go once sessions load; `detachedViews` follows the sessions-view
 * windows open on `kernel/windows`; `sessionActive` / `workspaceActive`
 * follow the state (a session behind a sessions view is not active).
 */
export function provideNavigator(sdk: PluginSdk): NavigatorControls {
	const windowId = sdk.windowId ?? "main";
	const navigator: DomainProvider<typeof Navigator> = sdk.domains.provide(Navigator, {
		initialState: { ...readSavedNavigator(windowId), detachedViews: [] },
		methods: {
			setFocus: ({ focus }) => update({ focus }),
			open: ({ sessionId }) => {
				update({ activeSessionId: sessionId, view: null });
				goHome();
			},
			close: () => {
				update({ activeSessionId: null, view: null });
				goHome();
			},
			showView: ({ view }) => {
				const windowOfView = view && detachedWindowId(view);
				if (windowOfView) {
					void sdk.domains
						.get(KernelWindows)
						?.methods.focus({ windowId: windowOfView })
						.catch(() => undefined);
					return;
				}
				update({ view });
				goHome();
			},
		},
	});

	function detachedWindowId(view: string): string | null {
		const windows = sdk.domains.get(KernelWindows)?.getState();
		return (
			(windows && detachedViewWindows(windows).find((entry) => entry.view === view)?.windowId) ??
			null
		);
	}
	function goHome(): void {
		void sdk.domains
			.get(Navigation)
			?.methods.goHome(undefined)
			.catch(() => undefined);
	}
	function update(patch: Partial<NavigatorState>): void {
		const next = { ...navigator.state, ...patch };
		navigator.setState(next);
		const saved: SavedState = {
			focus: next.focus,
			activeSessionId: next.activeSessionId,
			view: next.view,
		};
		try {
			localStorage.setItem(navigatorStorageKey(windowId), JSON.stringify(saved));
		} catch {
			// The window keeps its state in memory when storage is unavailable.
		}
		publishKeys(next);
	}
	function publishKeys(state: NavigatorState): void {
		sdk.context.set("sessionActive", state.activeSessionId !== null && state.view === null);
		sdk.context.set("workspaceActive", state.focus !== null);
	}
	publishKeys(navigator.state);

	const stops: (() => void)[] = [];
	sdk.domains.track(Sessions, {
		added(sessions) {
			const forgetMissing = ({ sessions: list }: { sessions: readonly { id: string }[] }) => {
				const active = navigator.state.activeSessionId;
				if (active && !list.some((session) => session.id === active)) {
					update({ activeSessionId: null });
				}
			};
			forgetMissing(sessions.getState());
			stops.push(sessions.subscribe(forgetMissing));
		},
		removed() {},
	});
	sdk.domains.track(KernelWindows, {
		added(windows) {
			const follow = (state: ReturnType<typeof windows.getState>) => {
				const views = detachedViewWindows(state).map((entry) => entry.view);
				const current = navigator.state.detachedViews;
				if (views.length === current.length && views.every((view, i) => view === current[i])) {
					return;
				}
				navigator.setState({ ...navigator.state, detachedViews: views });
			};
			follow(windows.getState());
			stops.push(windows.subscribe(follow));
		},
		removed() {
			if (navigator.state.detachedViews.length > 0) {
				navigator.setState({ ...navigator.state, detachedViews: [] });
			}
		},
	});
	sdk.onDispose(() => {
		for (const stop of stops.splice(0)) stop();
	});
	return {
		navigator,
		showInPlace(view) {
			update({ view });
			goHome();
		},
	};
}
