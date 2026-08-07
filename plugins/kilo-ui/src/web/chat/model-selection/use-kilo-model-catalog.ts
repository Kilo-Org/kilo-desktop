import { useQuery } from "@tanstack/react-query";

import type { KiloWorkspaceConnection } from "../../../contracts/chat/schemas.js";
import {
	buildCatalogFromProviderList,
	type KiloModelCatalog,
	type KiloProviderListPayload,
} from "./model-catalog.js";
import { createKiloRuntimeClient } from "../runtime/create-kilo-runtime-client.js";

async function fetchModelCatalog(connection: KiloWorkspaceConnection): Promise<KiloModelCatalog> {
	const client = createKiloRuntimeClient(connection);
	const { data } = await client.provider.list({}, { throwOnError: true });
	return buildCatalogFromProviderList(data as KiloProviderListPayload);
}

export function useKiloModelCatalog(connection: KiloWorkspaceConnection | undefined) {
	return useQuery({
		queryKey: [
			"kilo-ui",
			"provider.list",
			connection?.baseUrl,
			connection?.directory,
			connection?.username,
			connection?.version,
		],
		queryFn: () => {
			if (!connection) {
				throw new Error("Cannot fetch the model catalog before Kilo is connected");
			}
			return fetchModelCatalog(connection);
		},
		enabled: connection !== undefined,
		retry: false,
		staleTime: 60_000,
	});
}
