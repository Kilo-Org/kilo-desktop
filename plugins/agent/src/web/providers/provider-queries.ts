import type { QueryClient } from "@tanstack/react-query";

/** Prefix shared with the chat model catalog (`useKiloModelCatalog`). */
export const KILO_PROVIDER_LIST_QUERY_KEY = ["kilo.agent", "provider.list"] as const;

export const KILO_PROVIDERS_MANAGE_QUERY_KEY = ["kilo.agent", "providers.manage"] as const;

export function invalidateKiloProviderQueries(queryClient: QueryClient): void {
	void queryClient.invalidateQueries({ queryKey: [...KILO_PROVIDER_LIST_QUERY_KEY] });
	void queryClient.invalidateQueries({ queryKey: [...KILO_PROVIDERS_MANAGE_QUERY_KEY] });
}
