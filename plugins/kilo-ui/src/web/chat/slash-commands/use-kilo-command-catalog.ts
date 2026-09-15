import { useQuery } from "@tanstack/react-query";
import type { Command } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";

export async function fetchCommandCatalogForConnection(
	connection: KiloGlobalConnection | undefined,
	directory: string | undefined,
): Promise<Command[]> {
	if (!connection) {
		throw new Error("Cannot fetch commands before Kilo is connected");
	}
	const resolvedDirectory = directory ?? connection.globalDirectory;
	const client = createKiloDirectoryClient(connection, resolvedDirectory);
	const { data } = await client.command.list(
		{ directory: resolvedDirectory },
		{ throwOnError: true },
	);
	return (data ?? []) as Command[];
}

export function useKiloCommandCatalog(
	connection: KiloGlobalConnection | undefined,
	directory: string | undefined,
) {
	const resolvedDirectory = directory ?? connection?.globalDirectory;
	return useQuery({
		queryKey: [
			"kilo-ui",
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
