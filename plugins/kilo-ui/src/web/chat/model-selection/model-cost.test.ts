import { describe, expect, it } from "vitest";

import { modelCostTier } from "./model-cost.js";

describe("modelCostTier", () => {
	it.each([
		{ output: 1, tier: "low" },
		{ output: 1.01, tier: "medium" },
		{ output: 5, tier: "medium" },
		{ output: 5.01, tier: "high" },
		{ output: 15, tier: "high" },
		{ output: 15.01, tier: "very-high" },
	])("classifies $output/M output pricing as $tier cost", ({ output, tier }) => {
		expect(modelCostTier({ output })).toBe(tier);
	});

	it("omits the tier when output pricing is unavailable", () => {
		expect(modelCostTier(undefined)).toBeUndefined();
		expect(modelCostTier({})).toBeUndefined();
		expect(modelCostTier({ output: 0 })).toBeUndefined();
	});
});
