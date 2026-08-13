import { describe, expect, it } from "vitest";

import { filterModelsBySearchQuery } from "./model-search.js";

const models = [
	{
		id: "anthropic/claude-sonnet",
		name: "Claude Sonnet",
		description: "Anthropic",
		keywords: ["anthropic", "claude"],
	},
	{
		id: "openai/gpt-5",
		name: "GPT-5",
		description: "OpenAI",
		keywords: ["openai"],
	},
	{
		id: "google/gemini-pro",
		name: "Gemini Pro",
		description: "Google",
	},
] as const;

describe("filterModelsBySearchQuery", () => {
	it("returns all models when the query is empty or whitespace", () => {
		expect(filterModelsBySearchQuery(models, "")).toEqual(models);
		expect(filterModelsBySearchQuery(models, "   ")).toEqual(models);
	});

	it("matches id, name, description, and keywords case-insensitively", () => {
		expect(filterModelsBySearchQuery(models, "SONNET").map((model) => model.id)).toEqual([
			"anthropic/claude-sonnet",
		]);
		expect(filterModelsBySearchQuery(models, "openai/").map((model) => model.id)).toEqual([
			"openai/gpt-5",
		]);
		expect(filterModelsBySearchQuery(models, "google").map((model) => model.id)).toEqual([
			"google/gemini-pro",
		]);
		expect(filterModelsBySearchQuery(models, "claude").map((model) => model.id)).toEqual([
			"anthropic/claude-sonnet",
		]);
	});

	it("returns an empty list when nothing matches", () => {
		expect(filterModelsBySearchQuery(models, "nope")).toEqual([]);
	});
});
