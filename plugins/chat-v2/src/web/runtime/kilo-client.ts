import {
	createKiloV2Client,
	createV1Client,
	v2ClientEventSubscriber,
} from "@kilo-desktop/react-opencode-v2";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { connectionOptions, overriddenKiloWire, type KiloWire } from "./kilo-wire";

export type { KiloWire } from "./kilo-wire";

/** Identifies a running server: a restart may change its address or password. */
export const connectionKey = (connection: ServerConnection) =>
	`${connection.baseUrl}\n${connection.username}\n${connection.password}`;

/** Production's wire: Kilo v2 through `@kilocode/client`, in v1 shapes (see kilo-wire.ts). */
export function createKiloV2Wire(): KiloWire {
	let key: string | undefined;
	let v2: ReturnType<typeof createKiloV2Client> | undefined;
	const v2For = (connection: ServerConnection) => {
		const next = connectionKey(connection);
		if (next !== key || !v2) {
			key = next;
			v2 = createKiloV2Client(connectionOptions(connection));
		}
		return v2;
	};
	return {
		client: (connection, directory) =>
			createV1Client(v2For(connection), { directory }) as unknown as KiloClient,
		subscribe: (connection, options) => v2ClientEventSubscriber(v2For(connection))(options),
	};
}

let v2Wire: KiloWire | undefined;

/** The wire every window's clients and stream use. */
export const kiloWire = (): KiloWire => overriddenKiloWire() ?? (v2Wire ??= createKiloV2Wire());

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
		this.#global ??= kiloWire().client(connection);
		return this.#global;
	}

	directory(connection: ServerConnection, directory: string): KiloClient {
		this.#follow(connection);
		let client = this.#byDirectory.get(directory);
		if (!client) {
			client = kiloWire().client(connection, directory);
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
