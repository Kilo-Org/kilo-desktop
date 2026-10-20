import { QueryCache, QueryClient } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";

import { LocalApiError } from "@kilo-desktop/contracts";
import { configureDesktopFocusManager } from "@kilo-desktop/sdk-react";

export function createDesktopQueryClient(): QueryClient {
	configureDesktopFocusManager();
	return new QueryClient({
		// One place reports every query error — once per error, after retries — so
		// hooks do not each repeat their own error logging. Sentry is only
		// initialized in the desktop shell, so capture is a no-op in standalone
		// browser mode.
		queryCache: new QueryCache({
			onError: (error, query) => {
				const queryKey = JSON.stringify(query.queryKey);
				console.error(`[query] ${queryKey}`, error);
				// Queries whose failures are expected (e.g. a catalog that is briefly
				// empty while Kilo starts) opt out of Sentry with
				// `meta: { reportToSentry: false }`; the console log above still fires.
				if (query.meta?.reportToSentry === false) return;
				if (Sentry.getClient()) {
					Sentry.captureException(error, { tags: { queryKey } });
				}
			},
		}),
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
