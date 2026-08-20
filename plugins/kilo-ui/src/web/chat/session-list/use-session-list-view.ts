import { useCallback, useEffect, useRef, useState } from "react";

import {
	DEFAULT_SESSION_LIST_VIEW,
	readSessionListPins,
	readSessionListView,
	toggleSessionListPin,
	writeSessionListPins,
	writeSessionListView,
	type SessionListView,
} from "./session-list-view.js";

/** Persist after commit so updaters stay pure; skip the hydrate write. */
export function useSessionListView() {
	const [view, setView] = useState(readSessionListView);
	const skip = useRef(true);

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

	const reset = useCallback(() => {
		setView(DEFAULT_SESSION_LIST_VIEW);
	}, []);

	return { view, update, reset };
}

export function useSessionListPins() {
	const [ids, setIds] = useState(readSessionListPins);
	const skip = useRef(true);

	useEffect(() => {
		if (skip.current) {
			skip.current = false;
			return;
		}
		writeSessionListPins(ids);
	}, [ids]);

	const toggle = useCallback((id: string) => {
		setIds((current) => toggleSessionListPin(current, id));
	}, []);

	return { ids, toggle };
}
