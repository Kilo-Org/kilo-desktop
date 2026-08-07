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
		{ id: "anthropic/claude-sonnet", name: "Claude Sonnet", ...defaultModel },
		{ id: "anthropic/claude-opus", name: "Claude Opus", ...alternateModel },
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

		act(() => result.current.setModel(alternateModel));

		expect(result.current.model).toEqual(alternateModel);
		expect(readModelSelection()).toEqual({ model: alternateModel, effort: "high" });

		act(() => result.current.setEffort("max"));

		expect(result.current.effort).toBe("max");
		expect(readModelSelection()).toEqual({ model: alternateModel, effort: "max" });
	});

	it("falls back to the catalog default and persists effort against that model", () => {
		writeModelSelection({ model: { providerID: "removed", modelID: "old-model" } });
		const { result } = renderHook(() => usePersistedModelSelection(catalog));

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.effort).toBeUndefined();

		act(() => result.current.setEffort("medium"));

		expect(readModelSelection()).toEqual({ model: defaultModel, effort: "medium" });
	});

	it("keeps effort in memory when no catalog model is available", () => {
		const { result } = renderHook(() => usePersistedModelSelection(undefined));

		expect(result.current.model).toBeUndefined();

		act(() => result.current.setEffort("low"));

		expect(result.current.effort).toBe("low");
		expect(localStorage.getItem(MODEL_SELECTION_STORAGE_KEY)).toBeNull();

		act(() => result.current.setModel(defaultModel));

		expect(readModelSelection()).toEqual({ model: defaultModel, effort: "low" });
	});
});
