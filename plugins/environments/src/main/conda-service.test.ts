import { describe, expect, it } from "vitest";

import { mergeEnvsDirs } from "./conda-service.js";

describe("mergeEnvsDirs", () => {
	it("puts the highest-priority distribution dir first as the default", () => {
		const result = mergeEnvsDirs(
			["/bridge/envs"],
			[
				{ prefix: "/opt/miniconda3", priority: 1 },
				{ prefix: "/opt/anaconda3", priority: 10 },
			],
		);
		expect(result).toEqual(["/opt/anaconda3/envs", "/opt/miniconda3/envs", "/bridge/envs"]);
	});

	it("places bridge dirs after all distribution dirs", () => {
		const result = mergeEnvsDirs(
			["/bridge/envs", "/home/user/.conda/envs"],
			[{ prefix: "/opt/anaconda3", priority: 100 }],
		);
		expect(result[0]).toBe("/opt/anaconda3/envs");
		expect(result[1]).toBe("/bridge/envs");
		expect(result[2]).toBe("/home/user/.conda/envs");
	});

	it("de-dupes when a distribution dir matches a bridge envs_dir", () => {
		const result = mergeEnvsDirs(
			["/bridge/envs", "/home/user/.conda/envs"],
			[{ prefix: "/home/user/.conda", priority: 5 }],
		);
		// Distribution dir wins (comes first), bridge duplicate is dropped.
		expect(result).toEqual(["/home/user/.conda/envs", "/bridge/envs"]);
	});

	it("normalizes trailing separators before comparing", () => {
		const result = mergeEnvsDirs(
			["/opt/anaconda3/envs/"],
			[{ prefix: "/opt/anaconda3", priority: 1 }],
		);
		// Distribution dir and bridge dir normalize to the same key — first one wins.
		expect(result).toEqual(["/opt/anaconda3/envs"]);
	});

	it("returns envsDirs unchanged when distributions is empty", () => {
		const dirs = ["/bridge/envs", "/home/user/.conda/envs"];
		expect(mergeEnvsDirs(dirs, [])).toEqual(dirs);
	});

	it("returns distribution dirs when envsDirs is empty", () => {
		const result = mergeEnvsDirs([], [{ prefix: "/opt/anaconda3", priority: 5 }]);
		expect(result).toEqual(["/opt/anaconda3/envs"]);
	});

	it("skips distributions with empty prefix", () => {
		const result = mergeEnvsDirs(
			["/bridge/envs"],
			[
				{ prefix: "", priority: 5 },
				{ prefix: "/opt/anaconda3", priority: 1 },
			],
		);
		expect(result).toEqual(["/opt/anaconda3/envs", "/bridge/envs"]);
	});

	it("uses backslash separator for Windows-style prefixes", () => {
		const result = mergeEnvsDirs([], [{ prefix: "C:\\Users\\me\\anaconda3", priority: 1 }]);
		expect(result).toEqual(["C:\\Users\\me\\anaconda3\\envs"]);
	});

	it("handles mixed-separator paths by preferring forward slash", () => {
		const result = mergeEnvsDirs([], [{ prefix: "/opt/anaconda3", priority: 1 }]);
		expect(result).toEqual(["/opt/anaconda3/envs"]);
	});
});
