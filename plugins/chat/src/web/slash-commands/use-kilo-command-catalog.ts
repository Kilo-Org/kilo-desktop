import { useQuery } from "@tanstack/react-query";
import type { Command } from "@kilocode/sdk/v2/client";

import type { ServerConnection as KiloGlobalConnection } from "@kilo-desktop/plugin-core/contracts";
import { directoryClient as createKiloDirectoryClient } from "../runtime/kilo-client";

export type KiloCommandCatalogEntry = Pick<
	Command,
	"name" | "description" | "agent" | "model" | "source" | "hints"
>;

export async function fetchCommandCatalogForConnection(
	connection: KiloGlobalConnection | undefined,
	directory: string | undefined,
): Promise<KiloCommandCatalogEntry[]> {
	if (!connection) {
		throw new Error("Cannot fetch commands before Kilo is connected");
	}
	const resolvedDirectory = directory ?? connection.globalDirectory;
	const client = createKiloDirectoryClient(connection, resolvedDirectory);
	const { data } = await client.command.list(
		{ directory: resolvedDirectory },
		{ throwOnError: true },
	);
	return (data ?? []).map(({ name, description, agent, model, source, hints }) => ({
		name,
		...(description !== undefined ? { description } : {}),
		...(agent !== undefined ? { agent } : {}),
		...(model !== undefined ? { model } : {}),
		...(source !== undefined ? { source } : {}),
		hints,
	}));
}

export function useKiloCommandCatalog(
	connection: KiloGlobalConnection | undefined,
	directory: string | undefined,
) {
	const resolvedDirectory = directory ?? connection?.globalDirectory;
	return useQuery({
		queryKey: [
			"kilo.chat",
			"command.list",
			connection?.baseUrl,
			connection?.version,
			resolvedDirectory,
		],
		queryFn: () => fetchCommandCatalogForConnection(connection, resolvedDirectory),
		enabled: connection !== undefined && resolvedDirectory !== undefined,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	});
}
