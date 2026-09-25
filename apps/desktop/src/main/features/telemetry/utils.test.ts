import { describe, expect, it } from "vitest";

import { calculatePeriodId } from "./utils.js";

describe("calculatePeriodId", () => {
	it("buckets time into rolling 65-day periods", () => {
		const periodMs = 60 * 60 * 24 * 65 * 1000;
		expect(calculatePeriodId(0)).toBe(0);
		expect(calculatePeriodId(periodMs)).toBe(1);
		expect(calculatePeriodId(periodMs * 2 + 5)).toBe(2);
	});

	it("applies a period offset", () => {
		expect(calculatePeriodId(0, 3)).toBe(3);
	});
});
