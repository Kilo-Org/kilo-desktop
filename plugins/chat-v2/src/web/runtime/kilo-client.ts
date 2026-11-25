import {
	createKiloClient,
	v2ClientEventSubscriber,
	type KiloClient,
} from "@kilo-desktop/react-opencode-v2";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { connectionOptions, type KiloWire } from "./kilo-wire";

export type { KiloWire } from "./kilo-wire";

/** Identifies a running server: a restart may change its address or password. */
export const connectionKey = (connection: ServerConnection) =>
	`${connection.baseUrl}\n${connection.username}\n${connection.password}`;

/** Production's wire: one Kilo v2 client per running server (see kilo-wire.ts). */
export function createKiloV2Wire(): KiloWire {
	let key: string | undefined;
	let client: KiloClient | undefined;
	const clientFor = (connection: ServerConnection) => {
		const next = connectionKey(connection);
		if (next !== key || !client) {
			key = next;
			client = createKiloClient(connectionOptions(connection));
		}
		return client;
	};
	return {
		client: clientFor,
		subscribe: (connection, options) => v2ClientEventSubscriber(clientFor(connection))(options),
	};
}

let v2Wire: KiloWire | undefined;

/** The wire every window's clients and stream use. */
export const kiloWire = (): KiloWire => (v2Wire ??= createKiloV2Wire());

/** The window's Kilo client for the given server. */
export function kiloClient(connection: ServerConnection): KiloClient {
	return kiloWire().client(connection);
}

/**
 * Where a call about a place goes: the chat's directory, or for a read that
 * has none, the directory kilo.core's server keeps its global reads in.
 */
export const locationOf = (connection: ServerConnection, directory?: string | null) => ({
	location: { directory: directory ?? connection.globalDirectory },
});

/** The window's Kilo clients, one per server connection (a restart gets a new one). */
export class KiloClients {
	client(connection: ServerConnection): KiloClient {
		return kiloClient(connection);
	}
}
