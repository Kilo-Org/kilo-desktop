import { describe, expect, it } from "vitest";

import { WEB_FEATURES } from "./features";

describe("WEB_FEATURES", () => {
	it("registers the anaconda-mcp browser feature with a no-op mainRegister", () => {
		const anacondaMcp = WEB_FEATURES.find((feature) => feature.id === "anaconda-mcp");

		expect(anacondaMcp).toBeDefined();
		expect(anacondaMcp?.browserRegister).toBeTypeOf("function");
		// In browser mode the main process is unavailable, so mainRegister is a
		// no-op that must be safe to invoke and return nothing.
		expect(anacondaMcp?.mainRegister(undefined as never)).toBeUndefined();
	});
});
