// Upstream imports `@opencode-ai/sdk/v2/client`. This copy keeps the v1 Kilo
// SDK's types as its vocabulary, and its client answers from Kilo v2 through
// `@kilocode/client` (`v2/v1-client.ts`).
export * from "@kilocode/sdk/v2/client";

export { KiloClient as OpencodeClient } from "@kilocode/sdk/v2/client";

export type { KiloClientConfig as OpencodeClientConfig } from "@kilocode/sdk/v2/client";

import type { KiloClient } from "@kilocode/sdk/v2/client";
import { createKiloV2Client, createV1Client } from "./v2/v1-client";

/** A client in v1's shape for a Kilo v2 server (and, given one, a chat directory). */
export function createOpencodeClient(config: {
	baseUrl?: string;
	headers?: Record<string, string>;
	directory?: string;
	fetch?: typeof globalThis.fetch;
}): KiloClient {
	const client = createKiloV2Client({
		baseUrl: config.baseUrl ?? "",
		...(config.headers ? { headers: config.headers } : {}),
		...(config.fetch ? { fetch: config.fetch } : {}),
	});
	return createV1Client(client, { directory: config.directory });
}
