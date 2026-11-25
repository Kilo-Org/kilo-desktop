import { describe, expect, it } from "vitest";

import { clamp, pct } from "./range";

describe("range helpers", () => {
	it("clamps and takes shares", () => {
		expect(clamp(Number.NaN, 1, 5)).toBe(1);
		expect(clamp(9, 1, 5)).toBe(5);
		expect(pct(1, 0)).toBe(0);
		expect(pct(1, 4)).toBe(25);
		expect(pct(9, 4)).toBe(100);
	});
});
