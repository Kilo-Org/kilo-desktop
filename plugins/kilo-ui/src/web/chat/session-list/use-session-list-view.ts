import { useCallback, useState } from "react";

import {
	DEFAULT_SESSION_LIST_VIEW,
	readSessionListPins,
	readSessionListView,
	toggleSessionListPin,
	writeSessionListPins,
	writeSessionListView,
	type SessionListView,
} from "./session-list-view.js";

export function useSessionListView() {
	const [view, setView] = useState(readSessionListView);

	const update = useCallback((patch: Partial<SessionListView>) => {
		setView((current) => {
			const next = { ...current, ...patch };
			writeSessionListView(next);
			return next;
		});
	}, []);

	const reset = useCallback(() => {
		writeSessionListView(DEFAULT_SESSION_LIST_VIEW);
		setView(DEFAULT_SESSION_LIST_VIEW);
	}, []);

	return { view, update, reset };
}

export function useSessionListPins() {
	const [ids, setIds] = useState(readSessionListPins);

	const toggle = useCallback((id: string) => {
		setIds((current) => {
			const next = toggleSessionListPin(current, id);
			writeSessionListPins(next);
			return next;
		});
	}, []);

	return { ids, toggle };
}
