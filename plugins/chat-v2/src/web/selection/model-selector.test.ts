import { describe, expect, it } from "vitest";

import { resolveModelEffort, type ModelOption } from "./model-selector";

const models: ModelOption[] = [
	{ id: "plain", name: "Plain" },
	{
		id: "reasoning",
		name: "Reasoning",
		efforts: [
			{ id: "low", name: "Low" },
			{ id: "medium", name: "Med" },
			{ id: "high", name: "High" },
		],
	},
	{
		id: "high-only",
		name: "High Only",
		efforts: [
			{ id: "high", name: "High" },
			{ id: "max", name: "Max" },
		],
	},
];

describe("resolveModelEffort", () => {
	it("returns undefined when the model has no effort levels", () => {
		expect(resolveModelEffort(models, "plain", "medium")).toBeUndefined();
		expect(resolveModelEffort(models, undefined, "medium")).toBeUndefined();
	});

	it("keeps a sticky effort when the model still supports it", () => {
		expect(resolveModelEffort(models, "reasoning", "high")).toBe("high");
		expect(resolveModelEffort(models, "high-only", "high")).toBe("high");
	});

	it("defaults to medium when available and nothing sticky applies", () => {
		expect(resolveModelEffort(models, "reasoning", undefined)).toBe("medium");
		expect(resolveModelEffort(models, "reasoning", "max")).toBe("medium");
	});

	it("defaults to the first effort when medium is unavailable", () => {
		expect(resolveModelEffort(models, "high-only", undefined)).toBe("high");
		expect(resolveModelEffort(models, "high-only", "low")).toBe("high");
	});
});
