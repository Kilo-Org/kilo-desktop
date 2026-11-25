import { OpenCode, type OpenCodeClient } from "@kilocode/client";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

/** Identifies a running server: a restart may change its address or password. */
export const connectionKey = (connection: ServerConnection) =>
	`${connection.baseUrl}\n${connection.username}\n${connection.password}`;

/** A Kilo v2 client for the running server, authenticated with its per-launch credentials. */
export function createKiloClient(connection: ServerConnection): OpenCodeClient {
	const credentials = globalThis.btoa(`${connection.username}:${connection.password}`);
	return OpenCode.make({
		baseUrl: connection.baseUrl,
		headers: { authorization: `Basic ${credentials}` },
		// Looked up per request, so a fetch installed later (a test's fake server) is used.
		fetch: (input, init) => globalThis.fetch(input, init),
	});
}

/**
 * The window's Kilo client, one per server connection. v2 calls name their
 * session (the server resolves its location) or take a `location`, so no
 * client is kept per directory.
 */
export class KiloClients {
	#key: string | undefined;
	#client: OpenCodeClient | undefined;

	for(connection: ServerConnection): OpenCodeClient {
		const key = connectionKey(connection);
		if (key !== this.#key || !this.#client) {
			this.#key = key;
			this.#client = createKiloClient(connection);
		}
		return this.#client;
	}
}

const shared = new KiloClients();

/** The window's client for the given server. */
export function kiloClient(connection: ServerConnection): OpenCodeClient {
	return shared.for(connection);
}
