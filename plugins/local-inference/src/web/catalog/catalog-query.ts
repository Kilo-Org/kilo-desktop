import { queryOptions } from "@tanstack/react-query";

import type { SDK } from "@kilo-desktop/feature-sdk";
import { sdkQueryOptions } from "@kilo-desktop/sdk-react";

import type { LocalInferenceServiceContract } from "../../contracts/schemas.js";
import { catalogAccountKey, type CatalogAnacondaAccount } from "./use-anaconda-account.js";

/**
 * `catalog.list` query scoped to the Anaconda account it is fetched with, and
 * held until that account has resolved. Every catalog read goes through here so
 * the dialog and the settings page share one cache entry per account.
 */
export function catalogListQueryOptions(
	sdk: SDK<LocalInferenceServiceContract>,
	account: CatalogAnacondaAccount,
) {
	const base = sdkQueryOptions(sdk, "catalog.list");
	return queryOptions({
		...base,
		queryKey: [...base.queryKey, catalogAccountKey(account)],
		enabled: !account.resolving,
		retry: false,
		staleTime: 5 * 60 * 1_000,
	});
}
