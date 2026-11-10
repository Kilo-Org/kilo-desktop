import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	DEFAULT_SESSION_LIST_VIEW,
	readSessionListView,
	SESSION_LIST_VIEW_STORAGE_KEY,
	writeSessionListView,
	type SessionListView,
} from "./session-list-view";

/**
 * The list's view options, kept in origin's localStorage key so people keep
 * their grouping, sort and filter. Adopts writes another window makes to the
 * key (`storage` events only reach other windows, so nothing echoes).
 */
export function useSessionListView() {
	const [view, setView] = useState(readSessionListView);
	const skip = useRef(true);

	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key === SESSION_LIST_VIEW_STORAGE_KEY) setView(readSessionListView());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	useEffect(() => {
		if (skip.current) {
			skip.current = false;
			return;
		}
		writeSessionListView(view);
	}, [view]);

	const update = useCallback((patch: Partial<SessionListView>) => {
		setView((current) => ({ ...current, ...patch }));
	}, []);
	const reset = useCallback(() => setView(DEFAULT_SESSION_LIST_VIEW), []);

	return useMemo(() => ({ view, update, reset }), [reset, update, view]);
}
