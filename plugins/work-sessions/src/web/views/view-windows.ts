import type { DomainObjectHandle, DomainObjectState, KernelWindows } from "@kilo-desktop/kernel";

/** The window view a popped-out work sessions view opens in. */
export const WORK_SESSIONS_VIEW_WINDOW = "kilo.work-sessions/work-sessions-view";

type WindowsState = DomainObjectState<typeof KernelWindows>;

export interface DetachedViewWindow {
	readonly windowId: string;
	/** The work sessions view's contribution key. */
	readonly view: string;
}

/** The work sessions views open in their own windows. */
export function detachedViewWindows(state: WindowsState): DetachedViewWindow[] {
	return Object.entries(state.windows).flatMap(([windowId, window]) =>
		window.view === WORK_SESSIONS_VIEW_WINDOW && window.params.view
			? [{ windowId, view: window.params.view }]
			: [],
	);
}

/** Opens a work sessions view in its own window, or shows the window it already has. */
export function popOutView(
	windows: DomainObjectHandle<typeof KernelWindows>,
	view: { readonly key: string; readonly title: string; readonly width?: number | undefined },
): Promise<unknown> {
	return windows.methods.open({
		view: WORK_SESSIONS_VIEW_WINDOW,
		key: view.key,
		title: view.title,
		params: { view: view.key },
		...(view.width ? { width: view.width } : {}),
	});
}

/** The main window's id, where work sessions views open work sessions. */
export function mainWindowId(state: WindowsState | undefined): string {
	const entry = Object.entries(state?.windows ?? {}).find(([, window]) => window.role === "main");
	return entry?.[0] ?? "main";
}
