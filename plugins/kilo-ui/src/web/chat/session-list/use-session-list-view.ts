import {
	createContext,
	createElement,
	useCallback,
	useContext,
	useEffect,
	useMemo,
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

	return useMemo(() => ({ view, update, reset }), [reset, update, view]);
}

type SessionListViewContextValue = ReturnType<typeof useSessionListViewState>;
type SessionListPinsContextValue = ReturnType<typeof useSessionListPinsState>;

const SessionListViewContext = createContext<SessionListViewContextValue | null>(null);
const SessionListPinsContext = createContext<SessionListPinsContextValue | null>(null);

/**
 * Shares the list's view options and pins with every surface showing these
 * chats (the sidebar and the workspace board), so a change in one shows in both.
 */
export function SessionListViewProvider({ children }: { children: ReactNode }) {
	const view = useSessionListViewState();
	const pins = useSessionListPinsState();
	return createElement(
		SessionListViewContext.Provider,
		{ value: view },
		createElement(SessionListPinsContext.Provider, { value: pins }, children),
	);
}

export function useSessionListView(): SessionListViewContextValue {
	const value = useContext(SessionListViewContext);
	if (!value) {
		throw new Error("useSessionListView must be used within a SessionListViewProvider.");
	}
	return value;
}

export function useSessionListPins(): SessionListPinsContextValue {
	const value = useContext(SessionListPinsContext);
	if (!value) {
		throw new Error("useSessionListPins must be used within a SessionListViewProvider.");
	}
	return value;
}

function useSessionListPinsState() {
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

	return useMemo(() => ({ ids, toggle }), [ids, toggle]);
}
