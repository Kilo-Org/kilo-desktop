import { describe, expect, it } from "vitest";

import { modelDisplayName } from "./model-format";

describe("modelDisplayName", () => {
	it("drops the quantization suffix from catalog downloads", () => {
		expect(
			modelDisplayName({
				name: "gemma-4-E2B-it (q4_k_m)",
				catalog: { modelId: "gemma", quantizationId: "q4" },
			}),
		).toBe("gemma-4-E2B-it");
	});

	it("keeps imported model names untouched", () => {
		expect(modelDisplayName({ name: "My model (tuned)" })).toBe("My model (tuned)");
	});
});
