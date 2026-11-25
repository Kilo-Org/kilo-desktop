import { describe, expect, it } from "vitest";

import { favoriteKeySet, sortModelsWithFavoritesFirst } from "./model-favorites";

describe("model-favorites", () => {
	it("sorts favorite models ahead of the rest without reordering within groups", () => {
		const models = [
			{ id: "anthropic/a" },
			{ id: "anthropic/b" },
			{ id: "openai/c" },
			{ id: "openai/d" },
		];
		const favoriteIds = favoriteKeySet([
			{ providerID: "openai", id: "d" },
			{ providerID: "anthropic", id: "b" },
		]);
		expect(sortModelsWithFavoritesFirst(models, favoriteIds).map((model) => model.id)).toEqual([
			"anthropic/b",
			"openai/d",
			"anthropic/a",
			"openai/c",
		]);
	});
});
