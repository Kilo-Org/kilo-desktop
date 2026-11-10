import { createKiloClient, type KiloClient } from "@kilocode/sdk/v2/client";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

/** Identifies a running server: a restart may change its address or password. */
export const connectionKey = (connection: ServerConnection) =>
	`${connection.baseUrl}\n${connection.username}\n${connection.password}`;

function connectionOptions(connection: ServerConnection) {
	const authorization = globalThis.btoa(`${connection.username}:${connection.password}`);
	return { baseUrl: connection.baseUrl, headers: { Authorization: `Basic ${authorization}` } };
}

/**
 * The window's Kilo clients, one per server connection: the global client
 * (no directory, so lookups and the event stream span every project) and one
 * per chat directory, where a chat's writes must go.
 */
export class KiloClients {
	#key: string | undefined;
	#global: KiloClient | undefined;
	readonly #byDirectory = new Map<string, KiloClient>();

	global(connection: ServerConnection): KiloClient {
		this.#follow(connection);
		this.#global ??= createKiloClient(connectionOptions(connection));
		return this.#global;
	}

	directory(connection: ServerConnection, directory: string): KiloClient {
		this.#follow(connection);
		let client = this.#byDirectory.get(directory);
		if (!client) {
			client = createKiloClient({ ...connectionOptions(connection), directory });
			this.#byDirectory.set(directory, client);
		}
		return client;
	}

	#follow(connection: ServerConnection): void {
		const key = connectionKey(connection);
		if (key === this.#key) return;
		this.#key = key;
		this.#global = undefined;
		this.#byDirectory.clear();
	}
}

const shared = new KiloClients();

/** A client for `directory` on the given server, shared by the window. */
export function directoryClient(connection: ServerConnection, directory: string): KiloClient {
	return shared.directory(connection, directory);
}
