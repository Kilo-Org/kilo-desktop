import { createKiloClient, type KiloClient } from "@kilocode/sdk/v2/client";

import type { ServerConnection } from "../../contracts";

function connectionOptions(connection: ServerConnection) {
	const authorization = globalThis.btoa(`${connection.username}:${connection.password}`);
	return {
		baseUrl: connection.baseUrl,
		headers: {
			Authorization: `Basic ${authorization}`,
		},
	};
}

export function createKiloGlobalClient(connection: ServerConnection): KiloClient {
	return createKiloClient(connectionOptions(connection));
}

export function createKiloDirectoryClient(
	connection: ServerConnection,
	directory: string,
): KiloClient {
	return createKiloClient({ ...connectionOptions(connection), directory });
}
