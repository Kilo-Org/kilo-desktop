import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MODEL_FAVORITES_STORAGE_KEY } from "./model-favorites.js";
import { useModelFavorites } from "./use-model-favorites.js";

afterEach(() => {
	cleanup();
	localStorage.removeItem(MODEL_FAVORITES_STORAGE_KEY);
});

describe("useModelFavorites", () => {
	it("keeps favorite ids stable until favorites change", () => {
		const { result, rerender } = renderHook(() => useModelFavorites());
		const initialFavoriteIds = result.current.favoriteIds;

		rerender();
		expect(result.current.favoriteIds).toBe(initialFavoriteIds);
		expect(result.current).not.toHaveProperty("favorites");

		act(() => {
			result.current.toggleFavorite({ providerID: "anthropic", modelID: "claude-sonnet" });
		});

		expect(result.current.favoriteIds).not.toBe(initialFavoriteIds);
		expect(result.current.favoriteIds).toEqual(new Set(["anthropic/claude-sonnet"]));
		expect(result.current.hasFavorites).toBe(true);
	});
});
