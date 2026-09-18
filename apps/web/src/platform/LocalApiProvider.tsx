import { createContext, useContext, type ReactNode } from "react";

import type { LocalApi } from "@kilo-desktop/contracts";

const LocalApiContext = createContext<LocalApi | null>(null);

export function LocalApiProvider({
	api,
	children,
}: {
	readonly api: LocalApi;
	readonly children: ReactNode;
}) {
	return <LocalApiContext.Provider value={api}>{children}</LocalApiContext.Provider>;
}

export function useLocalApi(): LocalApi {
	const api = useContext(LocalApiContext);
	if (!api) {
		throw new Error("useLocalApi must be used within LocalApiProvider.");
	}
	return api;
}
