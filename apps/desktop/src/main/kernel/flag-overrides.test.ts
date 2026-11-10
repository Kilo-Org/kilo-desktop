import { describe, expect, it } from "vitest";

import { parseFlagOverrides } from "./flag-overrides";

describe("parseFlagOverrides", () => {
	it("turns on every listed flag, ignoring blanks and spaces", () => {
		expect(parseFlagOverrides(" developer, ,workspace-board ")).toEqual({
			developer: true,
			"workspace-board": true,
		});
	});

	it("forces nothing when unset", () => {
		expect(parseFlagOverrides(undefined)).toEqual({});
	});
});
