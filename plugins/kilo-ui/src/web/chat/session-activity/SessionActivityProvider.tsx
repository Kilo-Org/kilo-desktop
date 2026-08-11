import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";

import type { SessionActivityStore, SessionActivityStoreState } from "./session-activity-store.js";

const SessionActivityContext = createContext<SessionActivityStore | null>(null);

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

function useSessionActivityStore(): SessionActivityStore {
	const store = useContext(SessionActivityContext);
	if (!store) {
		throw new Error("useSessionActivity requires SessionActivityProvider");
	}
	return store;
}

export function useSessionActivity<T>(selector: (state: SessionActivityStoreState) => T): T {
	return useStore(useSessionActivityStore(), selector);
}
