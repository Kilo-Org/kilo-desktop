import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
	invalidateKiloProviderQueries,
	KILO_PROVIDER_LIST_QUERY_KEY,
	KILO_PROVIDERS_MANAGE_QUERY_KEY,
} from "./provider-queries.js";

describe("invalidateKiloProviderQueries", () => {
	it("marks the chat catalog and settings provider list stale", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData([...KILO_PROVIDER_LIST_QUERY_KEY, "http://127.0.0.1", "1"], {
			providers: [],
		});
		queryClient.setQueryData([...KILO_PROVIDERS_MANAGE_QUERY_KEY, "http://127.0.0.1", "1"], {
			view: { connected: [], environment: [], popular: [] },
		});

		invalidateKiloProviderQueries(queryClient);

		expect(
			queryClient.getQueryState([...KILO_PROVIDER_LIST_QUERY_KEY, "http://127.0.0.1", "1"])
				?.isInvalidated,
		).toBe(true);
		expect(
			queryClient.getQueryState([...KILO_PROVIDERS_MANAGE_QUERY_KEY, "http://127.0.0.1", "1"])
				?.isInvalidated,
		).toBe(true);
	});
});
