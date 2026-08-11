import { describe, expect, it } from "vitest";

import type { KiloModelCatalog } from "./model-catalog.js";
import {
	effortsForOptimisticTrigger,
	formatEffortLabel,
	MODEL_SELECTION_STORAGE_KEY,
	normalizeStoredEfforts,
	readModelSelection,
	resolveStoredModel,
	writeModelSelection,
} from "./selection-storage.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const store = { ...initial };
	return {
		get length() {
			return Object.keys(store).length;
		},
		clear() {
			for (const key of Object.keys(store)) {
				delete store[key];
			}
		},
		getItem(key: string) {
			return Object.hasOwn(store, key) ? store[key]! : null;
		},
		key(index: number) {
			return Object.keys(store)[index] ?? null;
		},
		removeItem(key: string) {
			delete store[key];
		},
		setItem(key: string, value: string) {
			store[key] = value;
		},
	};
}

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

describe("selection-storage", () => {
	it("round-trips model, display name, effort, and effort options", () => {
		const storage = memoryStorage();
		const selection = {
			model: { providerID: "anthropic", modelID: "claude-sonnet" },
			name: "Claude Sonnet",
			effort: "high",
			efforts: [
				{ id: "low", name: "Low" },
				{ id: "high", name: "High" },
			],
		};
		writeModelSelection(selection, storage);
		expect(storage.getItem(MODEL_SELECTION_STORAGE_KEY)).toContain("Claude Sonnet");
		expect(readModelSelection(storage)).toEqual(selection);
	});

	it("still reads legacy payloads that only stored model and effort", () => {
		const storage = memoryStorage({
			[MODEL_SELECTION_STORAGE_KEY]: JSON.stringify({
				model: { providerID: "anthropic", modelID: "claude-sonnet" },
				effort: "high",
			}),
		});
		expect(readModelSelection(storage)).toEqual({
			model: { providerID: "anthropic", modelID: "claude-sonnet" },
			effort: "high",
		});
		expect(effortsForOptimisticTrigger("high", undefined)).toEqual([{ id: "high", name: "High" }]);
		expect(formatEffortLabel("medium")).toBe("Med");
	});

	it("ignores corrupt storage payloads", () => {
		const storage = memoryStorage({ [MODEL_SELECTION_STORAGE_KEY]: "{not-json" });
		expect(readModelSelection(storage)).toBeUndefined();

		storage.setItem(MODEL_SELECTION_STORAGE_KEY, JSON.stringify({ model: { providerID: "x" } }));
		expect(readModelSelection(storage)).toBeUndefined();
	});

	it("resolves a stored model only when it still exists in the catalog", () => {
		const stored = { providerID: "anthropic", modelID: "claude-sonnet" };
		expect(resolveStoredModel(undefined, stored)).toBeUndefined();
		expect(resolveStoredModel(catalog, stored)).toEqual(stored);
		expect(resolveStoredModel(catalog, { providerID: "openai", modelID: "gpt-5" })).toBeUndefined();
	});

	it("normalizes catalog effort flags into storable options", () => {
		expect(normalizeStoredEfforts(true)).toEqual([
			{ id: "low", name: "Low" },
			{ id: "medium", name: "Med" },
			{ id: "high", name: "High" },
		]);
		expect(normalizeStoredEfforts([{ id: "max", name: "Max" }])).toEqual([
			{ id: "max", name: "Max" },
		]);
	});
});
