import { queryOptions } from "@tanstack/react-query";

import { localInferenceQueryOptions, type LocalInferenceClient } from "../local-inference";
import { catalogAccountKey, type CatalogAccess } from "./use-catalog-access";

/**
 * The catalog read scoped to the account it is read for, and held until that
 * account has resolved. Every catalog read goes through here so the dialog
 * and the settings page share one cache entry per account.
 */
export function catalogListQueryOptions(client: LocalInferenceClient, access: CatalogAccess) {
	const base = localInferenceQueryOptions(client, "listCatalog");
	return queryOptions({
		...base,
		queryKey: [...base.queryKey, catalogAccountKey(access)],
		enabled: !access.resolving,
		retry: false,
		staleTime: 5 * 60 * 1_000,
	});
}
