import { createKiloClient, type KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";

function connectionOptions(connection: KiloGlobalConnection) {
	const authorization = globalThis.btoa(`${connection.username}:${connection.password}`);
	return {
		baseUrl: connection.baseUrl,
		headers: {
			Authorization: `Basic ${authorization}`,
		},
	};
}

export function createKiloGlobalClient(connection: KiloGlobalConnection): KiloClient {
	return createKiloClient(connectionOptions(connection));
}

export function createKiloDirectoryClient(
	connection: KiloGlobalConnection,
	directory: string,
): KiloClient {
	return createKiloClient({ ...connectionOptions(connection), directory });
}
