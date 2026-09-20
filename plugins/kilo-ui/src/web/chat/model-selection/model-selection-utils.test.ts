import { describe, expect, it } from "vitest";

import type { KiloModelCatalog } from "./model-catalog.js";
import {
	effortsForOptimisticTrigger,
	formatEffortLabel,
	normalizeEfforts,
	preserveEffort,
	resolveCatalogModel,
} from "./model-selection-utils.js";

const catalog: KiloModelCatalog = {
	providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
	models: [
		{
			id: "anthropic/claude-sonnet",
			name: "Claude Sonnet",
			providerID: "anthropic",
			modelID: "claude-sonnet",
		},
	],
	defaults: { anthropic: "claude-sonnet" },
};

describe("model-selection-utils", () => {
	it("formats and synthesizes effort options", () => {
		expect(formatEffortLabel("medium")).toBe("Med");
		expect(effortsForOptimisticTrigger("high", undefined)).toEqual([{ id: "high", name: "High" }]);
	});

	it("resolves a model only when it exists in the catalog", () => {
		const model = { providerID: "anthropic", modelID: "claude-sonnet" };
		expect(resolveCatalogModel(undefined, model)).toBeUndefined();
		expect(resolveCatalogModel(catalog, model)).toEqual(model);
		expect(
			resolveCatalogModel(catalog, { providerID: "openai", modelID: "gpt-5" }),
		).toBeUndefined();
	});

	it("normalizes catalog effort flags and options", () => {
		expect(normalizeEfforts(true)).toEqual([
			{ id: "low", name: "Low" },
			{ id: "medium", name: "Med" },
			{ id: "high", name: "High" },
		]);
		expect(normalizeEfforts([{ id: "max", name: "Max" }])).toEqual([{ id: "max", name: "Max" }]);
	});

	it("keeps or remaps effort to the nearest supported level", () => {
		const efforts = [
			{ id: "low", name: "Low" },
			{ id: "high", name: "High" },
		];

		expect(preserveEffort("low", efforts)).toBe("low");
		expect(preserveEffort("medium", efforts)).toBe("high");
		expect(preserveEffort("custom", efforts)).toBeUndefined();
		expect(preserveEffort("high", undefined)).toBeUndefined();
	});
});
