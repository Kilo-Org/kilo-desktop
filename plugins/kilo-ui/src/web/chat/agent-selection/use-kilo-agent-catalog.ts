import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
import { buildAgentCatalog, type KiloAgentCatalog } from "./agent-catalog.js";

async function fetchAgentCatalog(connection: KiloGlobalConnection): Promise<KiloAgentCatalog> {
	const client = createKiloDirectoryClient(connection, connection.globalDirectory);
	const { data } = await client.app.agents({}, { throwOnError: true });
	return buildAgentCatalog(data as Agent[]);
}

export function useKiloAgentCatalog(
	connection: KiloGlobalConnection | undefined,
	connectionUpdatedAt = 0,
) {
	return useQuery({
		queryKey: [
			"kilo-ui",
			"app.agents",
			connection?.baseUrl,
			connection?.version,
			connection?.globalDirectory,
			connectionUpdatedAt,
		],
		queryFn: () => {
			if (!connection) {
				throw new Error("Cannot fetch agents before Kilo is connected");
			}
			return fetchAgentCatalog(connection);
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
