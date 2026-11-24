// Browser and unit tests answer from an in-memory server that speaks the v1
// Kilo HTTP API (`fake-kilo-server.ts`), so they reach it through the v1 SDK
// instead of production's Kilo v2 wire. The UI under test sees the same v1
// shapes either way; react-opencode-v2's own tests cover the v2 translation.
import { createKiloClient } from "@kilocode/sdk/v2/client";

import { connectionOptions, setKiloWire } from "../web/runtime/kilo-wire";

setKiloWire({
	client: (connection, directory) =>
		createKiloClient({ ...connectionOptions(connection), ...(directory ? { directory } : {}) }),
	async subscribe(connection, options) {
		const client = createKiloClient(connectionOptions(connection));
		const given = (options ?? {}) as { headers?: Record<string, string> };
		const subscription = await client.global.event({
			...given,
			// A fork replays its copied transcript as durable `sync` copies too, which no thread reads.
			headers: { ...given.headers, "x-kilo-sse-skip-fork-sync": "1" },
		} as never);
		return { stream: subscription.stream as AsyncIterable<unknown> };
	},
});
