import { useSyncExternalStore } from "react";

/*
 * Window-local state the session list shares with kilo.workbench's commands,
 * which run outside React: whether search is open, and the order the list
 * shows sessions in (⌃1–9 and next / previous follow what is on screen).
 */

let searchOpen = false;
let visibleSessionIds: readonly string[] = [];
const searchListeners = new Set<() => void>();

function setSearchOpen(open: boolean): void {
	if (searchOpen === open) return;
	searchOpen = open;
	for (const listener of searchListeners) listener();
}

export const sessionSearch = {
	open: () => setSearchOpen(true),
	close: () => setSearchOpen(false),
	toggle: () => setSearchOpen(!searchOpen),
	set: setSearchOpen,
};

export function useSessionSearchOpen(): boolean {
	return useSyncExternalStore(
		(onChange) => {
			searchListeners.add(onChange);
			return () => searchListeners.delete(onChange);
		},
		() => searchOpen,
		() => searchOpen,
	);
}

/** Active (unarchived) sessions in the order the list shows them. */
export const visibleSessions = {
	get: (): readonly string[] => visibleSessionIds,
	set: (ids: readonly string[]): void => {
		visibleSessionIds = ids;
	},
};

/** Clears the window's list state, e.g. when the plugin activates again. */
export function resetListState(): void {
	setSearchOpen(false);
	visibleSessionIds = [];
}
