import { OpenCode, type OpenCodeClient } from "@kilocode/client";

import type { ServerConnection } from "../../contracts";

export type { OpenCodeClient as KiloClient } from "@kilocode/client";

export interface ServerClientOptions {
	/** The fetch the client sends requests with; the main host's network fetch in production. */
	readonly fetch?: typeof fetch;
}

/** A Kilo v2 client for the running server, authenticated with its per-launch credentials. */
export function createServerClient(
	connection: ServerConnection,
	options: ServerClientOptions = {},
): OpenCodeClient {
	const credentials = Buffer.from(`${connection.username}:${connection.password}`).toString(
		"base64",
	);
	return OpenCode.make({
		baseUrl: connection.baseUrl,
		headers: { authorization: `Basic ${credentials}` },
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
}

export interface LocationPluginsOptions {
	/** How long to wait for a cold location to list its plugins. */
	readonly waitMs?: number;
	/** How often to ask while waiting. */
	readonly pollMs?: number;
	/** Ends the wait early when it turns false (the caller was disposed or a newer read started). */
	readonly active?: () => boolean;
}

const LOCATION_PLUGINS_WAIT_MS = 30_000;
const LOCATION_PLUGINS_POLL_MS = 100;

function isRpcUnavailable(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"type" in error &&
		(error as { type: unknown }).type === "rpc.unavailable"
	);
}

/**
 * Calls a Kilo plugin RPC in `directory`'s location, tolerating a location that
 * is still starting. The server answers `rpc.unavailable` until the location's
 * plugins are registered, which is also the answer of a server without the
 * plugin; a location lists no plugins while it activates and all of them once
 * it has. So an `rpc.unavailable` answer waits for the location to list its
 * plugins and calls once more, and only a second such answer is final. Every
 * other failure rejects unchanged. Mirrors the v2 VS Code client's `readListed`.
 */
export async function callLocationRpc<T>(
	client: Pick<OpenCodeClient, "plugin">,
	directory: string,
	call: () => Promise<T>,
	options: LocationPluginsOptions = {},
): Promise<T> {
	try {
		return await call();
	} catch (error) {
		if (!isRpcUnavailable(error)) throw error;
		const active = options.active ?? (() => true);
		await waitForLocationPlugins(client, directory, active, options);
		if (!active()) throw error;
		return call();
	}
}

async function waitForLocationPlugins(
	client: Pick<OpenCodeClient, "plugin">,
	directory: string,
	active: () => boolean,
	options: LocationPluginsOptions,
): Promise<void> {
	const deadline = Date.now() + (options.waitMs ?? LOCATION_PLUGINS_WAIT_MS);
	const pollMs = options.pollMs ?? LOCATION_PLUGINS_POLL_MS;
	while (active() && Date.now() < deadline) {
		// A server without the inventory route ends the wait at once.
		const listed = await client.plugin.list({ location: { directory } }).then(
			(result) => result.data.length > 0,
			() => true,
		);
		if (listed) return;
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
}
