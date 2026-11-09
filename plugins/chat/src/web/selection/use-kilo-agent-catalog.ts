import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Agent } from "@kilocode/sdk/v2/client";

import type { ServerConnection as KiloGlobalConnection } from "@kilo-desktop/plugin-agent/contracts";
import { directoryClient as createKiloDirectoryClient } from "../runtime/kilo-client";
import { buildAgentCatalog, type KiloAgentCatalog } from "./agent-catalog";
import { useKiloAccountKey } from "./kilo-account-key";

/**
 * Guarded agent-catalog fetch used as the query function. Exported so the
 * "not connected yet" guard can be tested directly without depending on
 * react-query's disabled-query semantics.
 */
export async function fetchAgentCatalogForConnection(
	connection: KiloGlobalConnection | undefined,
): Promise<KiloAgentCatalog> {
	if (!connection) {
		throw new Error("Cannot fetch agents before Kilo is connected");
	}
	const client = createKiloDirectoryClient(connection, connection.globalDirectory);
	const { data } = await client.app.agents({}, { throwOnError: true });
	const agents = data as Agent[];
	return buildAgentCatalog(agents);
}

export function useKiloAgentCatalog(
	connection: KiloGlobalConnection | undefined,
	connectionUpdatedAt = 0,
) {
	const account = useKiloAccountKey();
	return useQuery({
		queryKey: [
			"kilo.chat",
			"app.agents",
			connection?.baseUrl,
			connection?.version,
			connection?.globalDirectory,
			connectionUpdatedAt,
			account,
		],
		queryFn: () => fetchAgentCatalogForConnection(connection),
		enabled: connection !== undefined,
		// Keeps the picker filled while an account change reads the agents again.
		placeholderData: keepPreviousData,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	});
}
