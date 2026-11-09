import { describe, expect, it } from "vitest";

import { EnvMap } from "./env-map.js";

describe("EnvMap", () => {
	it("stores and retrieves values", () => {
		const map = new EnvMap();
		expect(map.size).toBe(0);
		map.set("FOO", "bar");
		expect(map.get("FOO")).toBe("bar");
		expect(map.has("FOO")).toBe(true);
		expect(map.size).toBe(1);
		expect(map.get("MISSING")).toBeUndefined();
		expect(map.has("MISSING")).toBe(false);
	});

	it("preserves the case of the first-seen key", () => {
		const map = new EnvMap();
		map.set("foo", "1");
		map.set("FOO", "2");
		const entries = [...map.entries()];
		if (process.platform === "win32") {
			expect(entries).toEqual([["foo", "2"]]);
		} else {
			expect(entries).toEqual([
				["foo", "1"],
				["FOO", "2"],
			]);
		}
	});

	it("supports undefined values", () => {
		const map = new EnvMap([["FOO", "1"]] as const);
		map.set("FOO", undefined);
		expect(map.get("FOO")).toBeUndefined();
		expect([...map.values()]).toEqual([undefined]);
	});

	it("iterates keys, values and entries", () => {
		const map = new EnvMap([
			["A", "1"],
			["B", "2"],
		] as const);
		expect([...map.keys()]).toEqual(["A", "B"]);
		expect([...map.values()]).toEqual(["1", "2"]);
		expect([...map]).toEqual([
			["A", "1"],
			["B", "2"],
		]);
	});

	it("supports forEach", () => {
		const map = new EnvMap([
			["A", "1"],
			["B", "2"],
		] as const);
		const seen: Array<[string, string | undefined]> = [];
		map.forEach((value, key) => {
			seen.push([key, value]);
		});
		expect(seen).toEqual([
			["A", "1"],
			["B", "2"],
		]);
	});

	it("deletes and clears", () => {
		const map = new EnvMap([["A", "1"]] as const);
		expect(map.delete("A")).toBe(true);
		expect(map.delete("A")).toBe(false);
		map.set("B", "2");
		map.clear();
		expect(map.size).toBe(0);
	});

	it("reports its toString tag", () => {
		expect(Object.prototype.toString.call(new EnvMap())).toBe("[object EnvMap]");
	});
});
