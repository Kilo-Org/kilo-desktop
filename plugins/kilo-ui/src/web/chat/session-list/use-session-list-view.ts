import {
	createContext,
	createElement,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";

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
function useSessionListViewState() {
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

type SessionListViewContextValue = ReturnType<typeof useSessionListViewState>;

const SessionListViewContext = createContext<SessionListViewContextValue | null>(null);

export function SessionListViewProvider({ children }: { children: ReactNode }) {
	const value = useSessionListViewState();
	return createElement(SessionListViewContext.Provider, { value }, children);
}

export function useSessionListView(): SessionListViewContextValue {
	const value = useContext(SessionListViewContext);
	if (!value) {
		throw new Error("useSessionListView must be used within a SessionListViewProvider.");
	}
	return value;
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
