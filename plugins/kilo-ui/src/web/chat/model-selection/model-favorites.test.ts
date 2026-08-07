import { describe, expect, it } from "vitest";

import {
	favoriteKeySet,
	readModelFavorites,
	sortModelsWithFavoritesFirst,
	toggleModelFavorite,
	writeModelFavorites,
	MODEL_FAVORITES_STORAGE_KEY,
} from "./model-favorites.js";

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

describe("model-favorites", () => {
	it("round-trips favorites through storage", () => {
		const storage = memoryStorage();
		const favorites = [
			{ providerID: "anthropic", modelID: "claude-sonnet" },
			{ providerID: "openai", modelID: "gpt-5" },
		];
		writeModelFavorites(favorites, storage);
		expect(storage.getItem(MODEL_FAVORITES_STORAGE_KEY)).toContain("claude-sonnet");
		expect(readModelFavorites(storage)).toEqual(favorites);
	});

	it("ignores corrupt storage payloads", () => {
		const storage = memoryStorage({ [MODEL_FAVORITES_STORAGE_KEY]: "{not-json" });
		expect(readModelFavorites(storage)).toEqual([]);

		storage.setItem(MODEL_FAVORITES_STORAGE_KEY, JSON.stringify([{ providerID: "x" }]));
		expect(readModelFavorites(storage)).toEqual([]);
	});

	it("toggles favorites by provider/model id", () => {
		const target = { providerID: "anthropic", modelID: "claude-sonnet" };
		const added = toggleModelFavorite([], target);
		expect(added).toEqual([target]);
		expect(toggleModelFavorite(added, target)).toEqual([]);
	});

	it("sorts favorite models ahead of the rest without reordering within groups", () => {
		const models = [
			{ id: "anthropic/a" },
			{ id: "anthropic/b" },
			{ id: "openai/c" },
			{ id: "openai/d" },
		];
		const favoriteIds = favoriteKeySet([
			{ providerID: "openai", modelID: "d" },
			{ providerID: "anthropic", modelID: "b" },
		]);
		expect(sortModelsWithFavoritesFirst(models, favoriteIds).map((model) => model.id)).toEqual([
			"anthropic/b",
			"openai/d",
			"anthropic/a",
			"openai/c",
		]);
	});
});
