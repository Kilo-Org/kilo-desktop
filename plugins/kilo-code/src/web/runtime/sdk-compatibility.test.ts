import { describe, expect, it, vi } from "vitest";

import { createOpencodeClient, type OpencodeClient } from "@assistant-ui/react-opencode";
import { createKiloClient, KiloClient } from "@kilocode/sdk/v2/client";

describe("OpenCode SDK compatibility facade", () => {
	it("uses Kilo clients for the adapter's OpenCode client surface", () => {
		const adapterClient: OpencodeClient = createKiloClient();
		const kiloClient: KiloClient = createOpencodeClient();

		expect(adapterClient).toBeInstanceOf(KiloClient);
		expect(kiloClient).toBeInstanceOf(KiloClient);
	});

	it("aliases the adapter client factory to Kilo's factory", () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const client = createOpencodeClient({
			baseUrl: "http://127.0.0.1:4096",
			fetch,
		});

		expect(client).toBeInstanceOf(KiloClient);
	});
});
