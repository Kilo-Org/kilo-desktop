import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import {
	shouldRetryStaleKiloQuery,
	STALE_KILO_QUERY_RETRY_DELAY_MS,
} from "../kilo-connection-error.js";
import {
	buildCatalogFromProviderList,
	parseModelId,
	type KiloModelCatalog,
	type KiloProviderListPayload,
} from "./model-catalog.js";
import { KILO_PROVIDER_LIST_QUERY_KEY } from "../../providers/provider-queries.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";

/**
 * Guarded catalog fetch used as the query function. Exported so the
 * "not connected yet" guard can be tested directly without depending on
 * react-query's disabled-query semantics.
 */
export async function fetchModelCatalogForConnection(
	connection: KiloGlobalConnection | undefined,
): Promise<KiloModelCatalog> {
	if (!connection) {
		throw new Error("Cannot fetch the model catalog before Kilo is connected");
	}
	const client = createKiloDirectoryClient(connection, connection.globalDirectory);
	const [{ data: providers }, { data: config }, authStatus] = await Promise.all([
		client.provider.list({}, { throwOnError: true }),
		client.config.get({}, { throwOnError: true }),
		client.kilo
			.authStatus({}, { throwOnError: true })
			.then(({ data }) => data)
			.catch(() => undefined),
	]);
	const catalog = buildCatalogFromProviderList(providers as KiloProviderListPayload, {
		connectedOnly: true,
	});
	const configuredModel = config.model ? parseModelId(config.model) : null;
	return {
		...catalog,
		...(configuredModel ? { configuredModel } : {}),
		providerReady: authStatus !== undefined,
		...(authStatus ? { organizationId: authStatus.organizationId ?? null } : {}),
	};
}

/**
 * Composer treats an empty catalog as "no models" and disables the picker.
 * While a refetch is in flight the previous empty list is still cached
 * (`keepPreviousData`), so `isPending` is false — treat that as pending so
 * the trigger shows loading instead of the no-entry cursor.
 */
export function isModelCatalogPending(query: {
	readonly isPending: boolean;
	readonly isFetching?: boolean;
	readonly data?: { readonly models: readonly unknown[] } | undefined;
}): boolean {
	if (query.isPending) return true;
	if (!query.isFetching) return false;
	return (query.data?.models.length ?? 0) === 0;
}

export function useKiloModelCatalog(
	connection: KiloGlobalConnection | undefined,
	connectionUpdatedAt = 0,
) {
	return useQuery({
		queryKey: [
			...KILO_PROVIDER_LIST_QUERY_KEY,
			connection?.baseUrl,
			connection?.version,
			connection?.globalDirectory,
			connectionUpdatedAt,
		],
		queryFn: () => fetchModelCatalogForConnection(connection),
		enabled: connection !== undefined,
		placeholderData: keepPreviousData,
		retry: shouldRetryStaleKiloQuery,
		retryDelay: STALE_KILO_QUERY_RETRY_DELAY_MS,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	});
}
