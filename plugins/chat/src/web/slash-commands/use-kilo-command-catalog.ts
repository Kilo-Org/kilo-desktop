import { useQuery } from "@tanstack/react-query";

import type { ServerConnection as KiloGlobalConnection } from "@kilo-desktop/plugin-core/contracts";
import { kiloClient } from "../runtime/kilo-client";
import type { SlashSourceCategory } from "./kilo-slash-command";

/** A server slash command as the `/` menu lists it (v2 lists skills apart, so these are commands). */
export interface KiloCommandCatalogEntry {
	readonly name: string;
	readonly description?: string;
	readonly source?: SlashSourceCategory;
}

export async function fetchCommandCatalogForConnection(
	connection: KiloGlobalConnection | undefined,
	directory: string | undefined,
): Promise<KiloCommandCatalogEntry[]> {
	if (!connection) {
		throw new Error("Cannot fetch commands before Kilo is connected");
	}
	const resolvedDirectory = directory ?? connection.globalDirectory;
	const { data } = await kiloClient(connection).command.list({
		location: { directory: resolvedDirectory },
	});
	return data.map(({ name, description }) => ({
		name,
		...(description !== undefined ? { description } : {}),
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
