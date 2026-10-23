import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useStore } from "zustand";

import { createSessionsStore, type SessionsState, type SessionsStore } from "./sessions-store.js";
import type { SessionsSync } from "./sessions-sync.js";

type SessionsContextValue = { readonly store: SessionsStore; readonly sync: SessionsSync | null };

const SessionsContext = createContext<SessionsContextValue | null>(null);
const emptySessions: SessionsContextValue = { store: createSessionsStore([]), sync: null };

export function SessionsProvider({
	store,
	sync,
	children,
}: {
	store: SessionsStore;
	sync: SessionsSync | null;
	children: ReactNode;
}) {
	const value = useMemo(() => ({ store, sync }), [store, sync]);
	return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

/** Reads this window's work sessions; outside the provider, a loaded empty set. */
export function useSessions<T>(selector: (state: SessionsState) => T): T {
	return useStore((useContext(SessionsContext) ?? emptySessions).store, selector);
}

/** This window's session writes; null outside the provider. */
export function useSessionsSync(): SessionsSync | null {
	return (useContext(SessionsContext) ?? emptySessions).sync;
}
