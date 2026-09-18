import { QueryClient } from "@tanstack/react-query";

import { LocalApiError } from "@kilo-desktop/contracts";
import { configureDesktopFocusManager } from "@kilo-desktop/sdk-react";

export function createDesktopQueryClient(): QueryClient {
	configureDesktopFocusManager();
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				gcTime: 5 * 60_000,
				refetchOnWindowFocus: false,
				retry: (failureCount, error) =>
					failureCount < 1 &&
					error instanceof LocalApiError &&
					(error.code === "TRANSPORT" || error.code === "INTERNAL"),
			},
			mutations: {
				retry: false,
			},
		},
	});
}
