import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineContract, defineMethod } from "./contract.js";
import { sdkProducerContract } from "./features/sdk-producer.js";

describe("defineContract", () => {
	it("returns the channel map unchanged (runtime is a plain object)", () => {
		const channels = { ping: defineMethod(z.undefined(), z.string()) };
		expect(defineContract(channels)).toBe(channels);
	});

	it("sdkProducerContract defines the sdk-producer feature channels", () => {
		expect(Object.keys(sdkProducerContract)).toEqual(["list", "add", "delete", "clear", "echo"]);
		expect(sdkProducerContract.add.input.parse({ text: "  hello " })).toEqual({
			text: "hello",
		});
		expect(() => sdkProducerContract.add.input.parse({ text: "  " })).toThrow();
	});
});
