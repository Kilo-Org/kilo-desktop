import { describe, expect, it } from "vitest";

import { filterShowcaseModels, SHOWCASE_QUERIES, typingScript } from "./showcase-models";

describe("filterShowcaseModels", () => {
	it("lists one model per lab while the search is empty", () => {
		expect(filterShowcaseModels("").map((model) => model.name)).toEqual([
			"Claude",
			"GPT",
			"Gemini",
			"Grok",
			"Mistral",
			"DeepSeek",
		]);
	});

	it("narrows to the variants whose name starts with the query, ignoring case", () => {
		expect(filterShowcaseModels("cl").map((model) => model.name)).toEqual([
			"Claude Sonnet",
			"Claude Opus",
			"Claude Haiku",
		]);
		expect(filterShowcaseModels("GPT").map((model) => model.name)).toEqual([
			"GPT",
			"GPT mini",
			"GPT Codex",
		]);
	});

	it("has matches for every scripted query", () => {
		for (const query of SHOWCASE_QUERIES) {
			expect(filterShowcaseModels(query).length).toBeGreaterThan(0);
		}
	});
});

describe("typingScript", () => {
	it("types each query a character at a time, holds it, then backspaces", () => {
		expect(typingScript(["ab"]).map((frame) => frame.text)).toEqual(["", "a", "ab", "a"]);
	});

	it("holds longest on the idle list and the finished query", () => {
		const [idle, typing, typed, erasing] = typingScript(["ab"]);
		expect(idle!.holdMs).toBeGreaterThan(typing!.holdMs);
		expect(typed!.holdMs).toBeGreaterThan(typing!.holdMs);
		expect(erasing!.holdMs).toBeLessThan(typing!.holdMs);
	});

	it("chains queries so the loop never repeats a frame back to back", () => {
		const texts = typingScript(["ab", "cd"]).map((frame) => frame.text);
		expect(texts).toEqual(["", "a", "ab", "a", "", "c", "cd", "c"]);
	});
});
