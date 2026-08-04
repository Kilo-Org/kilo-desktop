import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineContract, defineMethod } from "./contract.js";

describe("defineContract", () => {
	it("returns the channel map unchanged (runtime is a plain object)", () => {
		const channels = { ping: defineMethod(z.undefined(), z.string()) };
		expect(defineContract(channels)).toBe(channels);
	});
});
