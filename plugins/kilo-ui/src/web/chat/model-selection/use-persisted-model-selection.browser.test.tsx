import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { KiloModelCatalog, KiloModelRef } from "./model-catalog.js";
import {
	MODEL_SELECTION_STORAGE_KEY,
	readModelSelection,
	writeModelSelection,
} from "./selection-storage.js";
import { usePersistedModelSelection } from "./use-persisted-model-selection.js";

const defaultModel: KiloModelRef = {
	providerID: "anthropic",
	modelID: "claude-sonnet",
};
const alternateModel: KiloModelRef = {
	providerID: "anthropic",
	modelID: "claude-opus",
};
const catalog: KiloModelCatalog = {
	providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
	models: [
		{
			id: "anthropic/claude-sonnet",
			name: "Claude Sonnet",
			...defaultModel,
			efforts: [
				{ id: "low", name: "Low" },
				{ id: "medium", name: "Med" },
				{ id: "high", name: "High" },
			],
		},
		{
			id: "anthropic/claude-opus",
			name: "Claude Opus",
			...alternateModel,
			efforts: [
				{ id: "low", name: "Low" },
				{ id: "medium", name: "Med" },
				{ id: "high", name: "High" },
				{ id: "max", name: "Max" },
			],
		},
	],
	defaults: { anthropic: "claude-sonnet" },
};

afterEach(() => {
	cleanup();
	localStorage.removeItem(MODEL_SELECTION_STORAGE_KEY);
});

describe("usePersistedModelSelection", () => {
	it("restores a valid selection and preserves its effort when the model changes", () => {
		writeModelSelection({ model: defaultModel, effort: "high" });
		const { result } = renderHook(() => usePersistedModelSelection(catalog));

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.effort).toBe("high");
		expect(result.current.name).toBe("Claude Sonnet");

		act(() => result.current.setModel(alternateModel));

		expect(result.current.model).toEqual(alternateModel);
		expect(result.current.name).toBe("Claude Opus");
		expect(readModelSelection()).toEqual({
			model: alternateModel,
			name: "Claude Opus",
			effort: "high",
			efforts: [
				{ id: "low", name: "Low" },
				{ id: "medium", name: "Med" },
				{ id: "high", name: "High" },
				{ id: "max", name: "Max" },
			],
		});

		act(() => result.current.setEffort("max"));

		expect(result.current.effort).toBe("max");
		expect(readModelSelection()?.effort).toBe("max");
	});

	it("falls back to the catalog default and persists effort against that model", () => {
		writeModelSelection({ model: { providerID: "removed", modelID: "old-model" } });
		const { result } = renderHook(() => usePersistedModelSelection(catalog));

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.effort).toBeUndefined();

		act(() => result.current.setEffort("medium"));

		expect(readModelSelection()).toMatchObject({
			model: defaultModel,
			name: "Claude Sonnet",
			effort: "medium",
		});
	});

	it("surfaces the stored model, name, and effort before the catalog loads", () => {
		writeModelSelection({
			model: defaultModel,
			name: "Claude Sonnet",
			effort: "high",
			efforts: [{ id: "high", name: "High" }],
		});
		const { result } = renderHook(() => usePersistedModelSelection(undefined));

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.name).toBe("Claude Sonnet");
		expect(result.current.effort).toBe("high");
		expect(result.current.efforts).toEqual([{ id: "high", name: "High" }]);
	});

	it("keeps effort in memory when nothing is stored and the catalog is missing", () => {
		const { result } = renderHook(() => usePersistedModelSelection(undefined));

		expect(result.current.model).toBeUndefined();

		act(() => result.current.setEffort("low"));

		expect(result.current.effort).toBe("low");
		expect(localStorage.getItem(MODEL_SELECTION_STORAGE_KEY)).toBeNull();

		act(() => result.current.setModel(defaultModel));

		expect(readModelSelection()).toEqual({ model: defaultModel, effort: "low" });
	});
});
