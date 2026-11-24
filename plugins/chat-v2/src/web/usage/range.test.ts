import { describe, expect, it } from "vitest";

import { announced, clamp, pct } from "./range";

describe("range helpers", () => {
	it("clamps, takes shares and rounds what is announced", () => {
		expect(clamp(Number.NaN, 1, 5)).toBe(1);
		expect(clamp(9, 1, 5)).toBe(5);
		expect(pct(1, 0)).toBe(0);
		expect(pct(1, 4)).toBe(25);
		expect(pct(9, 4)).toBe(100);
		expect(announced(33.333)).toBe(33.3);
	});
});
