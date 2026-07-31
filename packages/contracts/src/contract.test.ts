import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineContract, defineMethod } from "./contract.js";
import { todosContract } from "./features/todos.js";

describe("defineContract", () => {
	it("returns the channel map unchanged (runtime is a plain object)", () => {
		const channels = { ping: defineMethod(z.undefined(), z.string()) };
		expect(defineContract(channels)).toBe(channels);
	});

	it("todosContract defines the todos feature channels", () => {
		expect(Object.keys(todosContract)).toEqual(["list", "add", "toggle"]);
		expect(todosContract.add.input.parse({ title: "  Buy milk " })).toEqual({
			title: "Buy milk",
		});
		expect(() => todosContract.add.input.parse({ title: "  " })).toThrow();
	});
});
