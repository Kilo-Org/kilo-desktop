import { describe, expect, it } from "vitest";

import {
	installedLocalModelsFromChangedPayload,
	modelsIndicateInstalled,
} from "./use-installed-local-models.js";

describe("modelsIndicateInstalled", () => {
	it("is false for a missing or empty list", () => {
		expect(modelsIndicateInstalled(undefined)).toBe(false);
		expect(modelsIndicateInstalled([])).toBe(false);
		expect(modelsIndicateInstalled([null])).toBe(false);
	});

	it("treats available models as installed", () => {
		expect(modelsIndicateInstalled([{ id: "qwen-3", available: true }])).toBe(true);
		expect(modelsIndicateInstalled([{ id: "qwen-3" }])).toBe(true);
	});

	it("ignores models that are not available", () => {
		expect(modelsIndicateInstalled([{ id: "qwen-3", available: false }])).toBe(false);
	});
});

describe("installedLocalModelsFromChangedPayload", () => {
	it("reads model ids from the models-changed payload", () => {
		expect(installedLocalModelsFromChangedPayload({ modelIds: ["qwen-3"] })).toBe(true);
		expect(installedLocalModelsFromChangedPayload({ modelIds: [] })).toBe(false);
	});

	it("ignores payloads that omit model ids", () => {
		expect(installedLocalModelsFromChangedPayload(undefined)).toBeUndefined();
		expect(installedLocalModelsFromChangedPayload({})).toBeUndefined();
	});
});
