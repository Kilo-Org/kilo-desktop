import { describe, expect, it } from "vitest";

import { ELECTRON_HOST_PROTOCOL_VERSION } from "@runtimed/node/electron";

import { NTERACT_ELECTRON_HOST_PROTOCOL_VERSION } from "./schemas.js";

describe("notebook host contract", () => {
	it("matches the protocol implemented by the installed nteract adapter", () => {
		expect(NTERACT_ELECTRON_HOST_PROTOCOL_VERSION).toBe(ELECTRON_HOST_PROTOCOL_VERSION);
	});
});
