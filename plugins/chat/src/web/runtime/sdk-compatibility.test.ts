import { describe, expect, it } from "vitest";

import { createOpencodeClient, type OpencodeClient } from "@kilo-desktop/react-opencode";
import { createKiloClient, KiloClient } from "@kilocode/sdk/v2/client";

describe("OpenCode SDK compatibility facade", () => {
	it("uses Kilo clients for the adapter's OpenCode client surface", () => {
		const adapterClient: OpencodeClient = createKiloClient();
		const kiloClient: KiloClient = createOpencodeClient();

		expect(adapterClient).toBeInstanceOf(KiloClient);
		expect(kiloClient).toBeInstanceOf(KiloClient);
	});
});
