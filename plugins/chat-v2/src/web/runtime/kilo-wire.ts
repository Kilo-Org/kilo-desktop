import type { OpenCodeEventSubscriber } from "@kilo-desktop/react-opencode-v2";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

/**
 * How kilo.chat reaches the Kilo server: clients in the v1 SDK's shape (the
 * vocabulary react-opencode and kilo.chat speak) and the window's event
 * stream as v1 events.
 *
 * Production talks to Kilo v2 through `@kilocode/client`, translated by
 * react-opencode-v2 (`createKiloV2Wire` in kilo-client.ts). Tests set a wire
 * over their in-memory v1 server (`test/v1-wire.ts`) until a v2 fake exists.
 * This module imports nothing at run time, so a test setup file can set the
 * wire without loading the runtime before a test's mocks.
 */
export interface KiloWire {
	client(connection: ServerConnection, directory?: string): KiloClient;
	subscribe(
		connection: ServerConnection,
		options: Parameters<OpenCodeEventSubscriber>[0],
	): ReturnType<OpenCodeEventSubscriber>;
}

let override: KiloWire | undefined;

/** The wire set in place of production's, if any. */
export const overriddenKiloWire = (): KiloWire | undefined => override;

/** Replaces production's wire (tests over an in-memory server). */
export function setKiloWire(next: KiloWire | undefined): void {
	override = next;
}

/** Basic-auth client options for a server connection. */
export function connectionOptions(connection: ServerConnection) {
	const authorization = globalThis.btoa(`${connection.username}:${connection.password}`);
	return { baseUrl: connection.baseUrl, headers: { Authorization: `Basic ${authorization}` } };
}
