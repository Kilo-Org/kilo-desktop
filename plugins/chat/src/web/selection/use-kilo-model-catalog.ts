import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ServerConnection as KiloGlobalConnection } from "@kilo-desktop/plugin-agent/contracts";
import {
	EMPTY_KILO_CATALOG_RETRY_DELAY_MS,
	EmptyKiloCatalogError,
	isEmptyKiloCatalogError,
	shouldRetryModelCatalogQuery,
	STALE_KILO_QUERY_RETRY_DELAY_MS,
} from "../runtime/kilo-connection-error";
import {
	buildCatalogFromProviderList,
	parseModelId,
	type KiloModelCatalog,
	type KiloProviderListPayload,
} from "./model-catalog";
import { directoryClient as createKiloDirectoryClient } from "../runtime/kilo-client";

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
	const providerList = providers as KiloProviderListPayload;
	// No providers at all usually means Kilo is still starting them; treat it as a
	// failure so the query refetches (bounded) instead of caching no models. A
	// populated-but-unconnected list is a legitimate steady state (e.g. signed out)
	// and must resolve to a normal catalog, not an error.
	if (providerList.all.length === 0) throw new EmptyKiloCatalogError();
	const catalog = buildCatalogFromProviderList(providerList, {
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
	const query = useQuery({
		queryKey: [
			"kilo.chat",
			"provider.list",
			connection?.baseUrl,
			connection?.version,
			connection?.globalDirectory,
			connectionUpdatedAt,
		],
		queryFn: () => fetchModelCatalogForConnection(connection),
		enabled: connection !== undefined,
		// An empty catalog is expected for a moment while Kilo starts its
		// providers; the query retries, so don't report it to Sentry.
		meta: { reportToSentry: false },
		placeholderData: keepPreviousData,
		retry: shouldRetryModelCatalogQuery,
		retryDelay: (_failureCount, error) =>
			isEmptyKiloCatalogError(error)
				? EMPTY_KILO_CATALOG_RETRY_DELAY_MS
				: STALE_KILO_QUERY_RETRY_DELAY_MS,
		// AI Providers (kilo.agent) can't reach this cache, so the model picker reads
		// it again when it opens, and a catalog older than a minute is read again
		// when a pane mounts or the window regains focus.
		staleTime: 60_000,
		gcTime: Number.POSITIVE_INFINITY,
		refetchOnReconnect: false,
	});

	return query;
}
