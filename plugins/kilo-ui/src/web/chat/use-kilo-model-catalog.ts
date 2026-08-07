import { useQuery } from "@tanstack/react-query";

import type { KiloWorkspaceConnection } from "../../contracts/chat/schemas.js";
import {
	buildCatalogFromProviderList,
	type KiloModelCatalog,
	type KiloProviderListPayload,
} from "./model-catalog.js";
import { createKiloRuntimeClient } from "./runtime/create-kilo-runtime-client.js";

async function fetchModelCatalog(
	connectionPromise: Promise<KiloWorkspaceConnection>,
): Promise<KiloModelCatalog> {
	const connection = await connectionPromise;
	const client = createKiloRuntimeClient(connection);
	const { data } = await client.provider.list({}, { throwOnError: true });
	return buildCatalogFromProviderList(data as KiloProviderListPayload);
}

export function useKiloModelCatalog(
	connectionPromise: Promise<KiloWorkspaceConnection>,
	scopeKey: string,
) {
	return useQuery({
		queryKey: ["kilo-ui", "provider.list", scopeKey],
		queryFn: () => fetchModelCatalog(connectionPromise),
		retry: false,
		staleTime: 60_000,
	});
}
