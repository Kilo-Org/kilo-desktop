import { listAgents } from "@kilo-desktop/react-opencode-v2";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ServerConnection as KiloGlobalConnection } from "@kilo-desktop/plugin-core/contracts";
import { kiloClient } from "../runtime/kilo-client";
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
	// Agents are the same in every folder; kilo.core's server reads them where it keeps its global reads.
	return buildAgentCatalog(await listAgents(kiloClient(connection), connection.globalDirectory));
}

export function useKiloAgentCatalog(
	connection: KiloGlobalConnection | undefined,
	connectionUpdatedAt = 0,
) {
	const account = useKiloAccountKey();
	return useQuery({
		queryKey: [
			"kilo.chat",
			"agent.list",
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
