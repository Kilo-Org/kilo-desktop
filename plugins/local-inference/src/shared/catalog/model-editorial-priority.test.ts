import { describe, expect, it } from "vitest";

import { getEditorialModelScore } from "./model-editorial-priority.js";

describe("editorial model priority", () => {
	it("recognizes publisher-prefixed and GGUF-suffixed model names", () => {
		expect(getEditorialModelScore("Qwen/Qwen3.8-27B-GGUF")).toBeGreaterThan(0);
	});

	it("preserves editorial order", () => {
		expect(getEditorialModelScore("Qwen3.6-35B-A3B")).toBeGreaterThan(
			getEditorialModelScore("Qwen3.8-27B"),
		);
		expect(getEditorialModelScore("Qwen3.8-27B")).toBeGreaterThan(
			getEditorialModelScore("Qwen3.5-9B"),
		);
	});

	it("uses a separate priority for small-model recommendations", () => {
		expect(getEditorialModelScore("Ministral-3-3B", "small")).toBe(30);
		expect(getEditorialModelScore("Ministral-3-3B", "text")).toBe(0);
	});

	it("does not boost unlisted models", () => {
		expect(getEditorialModelScore("Unlisted Model 27B")).toBe(0);
	});
});
