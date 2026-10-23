import { describe, expect, it } from "vitest";

import { mintSessionId } from "./session-id.js";

describe("mintSessionId", () => {
	it("mints a fresh opaque id each time", () => {
		const first = mintSessionId();
		expect(first).toMatch(/^wses_[0-9a-f-]{36}$/u);
		expect(mintSessionId()).not.toBe(first);
	});
});
