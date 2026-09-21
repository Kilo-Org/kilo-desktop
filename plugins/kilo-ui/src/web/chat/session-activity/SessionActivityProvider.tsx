import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";

import type { SessionActivityStore, SessionActivityStoreState } from "./session-activity-store.js";
import { createSessionActivityStore } from "./session-activity-store.js";

const SessionActivityContext = createContext<SessionActivityStore | null>(null);
const idleSessionActivityStore = createSessionActivityStore({ storage: null });

export function SessionActivityProvider({
	store,
	children,
}: {
	store: SessionActivityStore;
	children: ReactNode;
}) {
	return (
		<SessionActivityContext.Provider value={store}>{children}</SessionActivityContext.Provider>
	);
}

/**
 * The raw store handle — for imperative `getState()` reads at event time
 * (e.g. the delete flow's refresh-settled check) where subscribing would
 * re-render unnecessarily. Render-visible data must use `useSessionActivity`
 * selectors instead.
 */
export function useSessionActivityStore(): SessionActivityStore {
	const store = useContext(SessionActivityContext);
	if (!store) {
		throw new Error("useSessionActivity requires SessionActivityProvider");
	}
	return store;
}

export function useSessionActivity<T>(selector: (state: SessionActivityStoreState) => T): T {
	return useStore(useSessionActivityStore(), selector);
}

/** Same as `useSessionActivity`, but safe outside the provider (idle empty store). */
export function useOptionalSessionActivity<T>(
	selector: (state: SessionActivityStoreState) => T,
): T {
	const store = useContext(SessionActivityContext) ?? idleSessionActivityStore;
	return useStore(store, selector);
}
