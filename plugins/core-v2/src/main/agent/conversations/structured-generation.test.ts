import { describe, expect, it } from "vitest";

import {
	generateStructured,
	parseStructuredAnswer,
	structuredPrompt,
	StructuredAnswerError,
} from "./structured-generation";

const SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["title", "body"],
	properties: { title: { type: "string", maxLength: 20 }, body: { type: "string" } },
};

const REQUEST = { system: "Write PR text.", text: "Patch: …", schema: SCHEMA };

describe("structuredPrompt", () => {
	it("carries the instructions, the schema and the request, marked as data", () => {
		const prompt = structuredPrompt(REQUEST);

		expect(prompt).toContain("Write PR text.");
		expect(prompt).toContain(JSON.stringify(SCHEMA));
		expect(prompt).toMatch(/<request>\nPatch: …\n<\/request>/);
		expect(prompt.indexOf("Write PR text.")).toBeLessThan(prompt.indexOf("<request>"));
	});

	it("names what was wrong with the last answer when asked again", () => {
		expect(structuredPrompt(REQUEST, "body: missing")).toContain("body: missing");
	});
});

describe("parseStructuredAnswer", () => {
	it("reads a JSON object that matches the schema, with or without a code fence or prose", () => {
		const answer = { title: "Fix login", body: "Details" };
		expect(parseStructuredAnswer(JSON.stringify(answer), SCHEMA)).toEqual({
			ok: true,
			value: answer,
		});
		expect(parseStructuredAnswer(`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``, SCHEMA)).toEqual({
			ok: true,
			value: answer,
		});
		expect(parseStructuredAnswer(`Here it is: ${JSON.stringify(answer)} Done.`, SCHEMA)).toEqual({
			ok: true,
			value: answer,
		});
	});

	it("says why an answer is not usable", () => {
		expect(parseStructuredAnswer("no json here", SCHEMA)).toMatchObject({ ok: false });
		expect(parseStructuredAnswer("[1, 2]", SCHEMA)).toMatchObject({ ok: false });
		const invalid = parseStructuredAnswer(JSON.stringify({ title: "x".repeat(30) }), SCHEMA);
		expect(invalid).toMatchObject({ ok: false, error: expect.stringContaining("title") });
		expect(invalid).toMatchObject({ ok: false, error: expect.stringContaining("body") });
	});

	it("only requires an object when the schema can't be read", () => {
		expect(parseStructuredAnswer('{"a": 1}', { type: "nonsense-type" })).toEqual({
			ok: true,
			value: { a: 1 },
		});
	});
});

describe("generateStructured", () => {
	it("returns the first valid answer", async () => {
		const prompts: string[] = [];
		const answer = await generateStructured(async (prompt) => {
			prompts.push(prompt);
			return '{"title": "Fix", "body": "B"}';
		}, REQUEST);

		expect(answer).toEqual({ title: "Fix", body: "B" });
		expect(prompts).toHaveLength(1);
	});

	it("asks once more, naming the problem, then gives up", async () => {
		const prompts: string[] = [];
		const replies = ['{"title": "Fix"}', '{"title": "Fix", "body": "B"}'];
		await expect(
			generateStructured(async (prompt) => {
				prompts.push(prompt);
				return replies.shift()!;
			}, REQUEST),
		).resolves.toEqual({ title: "Fix", body: "B" });
		expect(prompts[1]).toContain("body");

		await expect(generateStructured(async () => "nope", REQUEST)).rejects.toBeInstanceOf(
			StructuredAnswerError,
		);
	});
});
