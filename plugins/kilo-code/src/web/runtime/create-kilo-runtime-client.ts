import { createKiloClient, type KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloWorkspaceConnection } from "../../contracts/schemas.js";

export function createKiloRuntimeClient(connection: KiloWorkspaceConnection): KiloClient {
	const authorization = globalThis.btoa(`${connection.username}:${connection.password}`);

	return createKiloClient({
		baseUrl: connection.baseUrl,
		directory: connection.directory,
		headers: {
			Authorization: `Basic ${authorization}`,
		},
	});
}
