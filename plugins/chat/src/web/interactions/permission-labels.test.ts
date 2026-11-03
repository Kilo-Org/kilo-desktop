import { describe, expect, it } from "vitest";

import { visiblePermissionPatterns } from "./permission-labels";

describe("visiblePermissionPatterns", () => {
	it("drops the bare wildcard", () => {
		expect(visiblePermissionPatterns(["*"])).toEqual([]);
	});

	it("keeps meaningful patterns and drops only the wildcard", () => {
		expect(visiblePermissionPatterns(["/tmp/out.ipynb", "*"])).toEqual(["/tmp/out.ipynb"]);
	});

	it("passes through when there are no patterns", () => {
		expect(visiblePermissionPatterns([])).toEqual([]);
	});
});
