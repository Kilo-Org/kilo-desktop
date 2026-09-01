import { describe, expect, it } from "vitest";

import { computePageNumbers } from "./compute-page-numbers.js";

describe("computePageNumbers", () => {
	it("returns all pages when total is 7 or fewer", () => {
		expect(computePageNumbers(0, 5)).toEqual([0, 1, 2, 3, 4]);
		expect(computePageNumbers(3, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	it("shows leading pages with trailing ellipsis when current is near start", () => {
		const result = computePageNumbers(2, 20);
		expect(result).toEqual([0, 1, 2, 3, 4, "ellipsis", 19]);
	});

	it("shows trailing pages with leading ellipsis when current is near end", () => {
		const result = computePageNumbers(17, 20);
		expect(result).toEqual([0, "ellipsis", 15, 16, 17, 18, 19]);
	});

	it("shows middle window with both ellipses when current is in the middle", () => {
		const result = computePageNumbers(10, 20);
		expect(result).toEqual([0, "ellipsis", 9, 10, 11, "ellipsis", 19]);
	});

	it("returns empty array for zero total", () => {
		expect(computePageNumbers(0, 0)).toEqual([]);
	});
});
