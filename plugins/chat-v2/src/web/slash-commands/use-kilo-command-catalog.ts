import {
	commandHints,
	listCommands,
	listSkills,
	type KiloClient,
} from "@kilo-desktop/react-opencode-v2";
import { useQuery } from "@tanstack/react-query";

import type { ServerConnection as KiloGlobalConnection } from "@kilo-desktop/plugin-core/contracts";
import { kiloClient } from "../runtime/kilo-client";

/** One of the server's `/` commands: a Kilo command or a skill, without its template. */
export interface KiloCommandCatalogEntry {
	readonly name: string;
	readonly description?: string;
	/** Where it comes from (`command.list`, `skill.list`, or an MCP server's prompt). */
	readonly source: "command" | "skill" | "mcp";
	/** A command's argument placeholders (`$1`, `$ARGUMENTS`), from its template. */
	readonly hints: readonly string[];
	/** A skill's id, which a prompt names to use it. */
	readonly skillId?: string;
}

/** A folder's skills; none from a server that can't list them. */
async function skillsOf(client: KiloClient, directory: string) {
	try {
		return await listSkills(client, directory);
	} catch {
		return [];
	}
}

export async function fetchCommandCatalogForConnection(
	connection: KiloGlobalConnection | undefined,
	directory: string | undefined,
): Promise<KiloCommandCatalogEntry[]> {
	if (!connection) {
		throw new Error("Cannot fetch commands before Kilo is connected");
	}
	const resolvedDirectory = directory ?? connection.globalDirectory;
	const client = kiloClient(connection);
	const [commands, skills] = await Promise.all([
		listCommands(client, resolvedDirectory),
		skillsOf(client, resolvedDirectory),
	]);
	return [
		...commands.map(({ name, description, template }) => ({
			name,
			...(description !== undefined ? { description } : {}),
			source: "command" as const,
			hints: commandHints(template),
		})),
		...skills.map(({ id, name, description }) => ({
			name,
			...(description !== undefined ? { description } : {}),
			source: "skill" as const,
			hints: [],
			skillId: id,
		})),
	];
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
