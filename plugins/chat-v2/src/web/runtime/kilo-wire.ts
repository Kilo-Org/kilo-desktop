import type { KiloClient, OpenCodeEventSubscriber } from "@kilo-desktop/react-opencode-v2";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

/**
 * How kilo.chat reaches the Kilo server: Kilo v2's own client
 * (`@kilocode/client`, through react-opencode-v2) and the window's event
 * stream. Sessions are global in v2: calls about a session name it, and
 * calls about a place (agents, commands, files, pending prompts) name their
 * location.
 *
 * Tests run it against an in-memory Kilo v2 server (`test/fake-kilo-server.ts`).
 */
export interface KiloWire {
	client(connection: ServerConnection): KiloClient;
	subscribe(
		connection: ServerConnection,
		options: Parameters<OpenCodeEventSubscriber>[0],
	): ReturnType<OpenCodeEventSubscriber>;
}

/** Basic-auth client options for a server connection. */
export function connectionOptions(connection: ServerConnection) {
	const authorization = globalThis.btoa(`${connection.username}:${connection.password}`);
	return { baseUrl: connection.baseUrl, headers: { Authorization: `Basic ${authorization}` } };
}
