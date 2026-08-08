import { useQuery } from "@tanstack/react-query";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import {
	buildCatalogFromProviderList,
	type KiloModelCatalog,
	type KiloProviderListPayload,
} from "./model-catalog.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";

async function fetchModelCatalog(connection: KiloGlobalConnection): Promise<KiloModelCatalog> {
	const client = createKiloDirectoryClient(connection, connection.globalDirectory);
	const { data } = await client.provider.list({}, { throwOnError: true });
	return buildCatalogFromProviderList(data as KiloProviderListPayload);
}

export function useKiloModelCatalog(connection: KiloGlobalConnection | undefined) {
	return useQuery({
		queryKey: ["kilo-ui", "provider.list"],
		queryFn: () => {
			if (!connection) {
				throw new Error("Cannot fetch the model catalog before Kilo is connected");
			}
			return fetchModelCatalog(connection);
		},
		enabled: connection !== undefined,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	});
}
