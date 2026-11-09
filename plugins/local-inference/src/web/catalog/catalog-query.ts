import { queryOptions } from "@tanstack/react-query";

import { localInferenceQueryOptions, type LocalInferenceClient } from "../local-inference.js";
import { catalogAccountKey, type CatalogAnacondaAccount } from "./use-anaconda-account.js";

/**
 * The catalog read scoped to the Anaconda account it is fetched with, and
 * held until that account has resolved. Every catalog read goes through here so
 * the dialog and the settings page share one cache entry per account.
 */
export function catalogListQueryOptions(
	client: LocalInferenceClient,
	account: CatalogAnacondaAccount,
) {
	const base = localInferenceQueryOptions(client, "listCatalog");
	return queryOptions({
		...base,
		queryKey: [...base.queryKey, catalogAccountKey(account)],
		enabled: !account.resolving,
		retry: false,
		staleTime: 5 * 60 * 1_000,
	});
}
