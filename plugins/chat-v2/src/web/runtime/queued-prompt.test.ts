import type { AppendMessage } from "@assistant-ui/react";
import { describe, expect, it } from "vitest";

import { prepareQueuedPrompt, prepareText, toQueuedParts } from "./queued-prompt";

function message(text: string, patch: Partial<AppendMessage> = {}): AppendMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		attachments: [],
		parentId: null,
		sourceId: null,
		runConfig: undefined,
		metadata: { custom: {} },
		createdAt: new Date(0),
		...patch,
	} as AppendMessage;
}

describe("toQueuedParts", () => {
	it("keeps text and file parts as kilo.core prompts take them and drops the rest", () => {
		expect(
			toQueuedParts([
				{ type: "text", text: "Hi", synthetic: true },
				{ type: "file", mime: "image/png", url: "data:image/png;base64,AA", filename: "a.png" },
				{ type: "file", mime: "text/plain", url: "file:///a.txt" },
				{ type: "agent", name: "plan" },
				{ type: "text", text: 3 },
			]),
		).toEqual([
			{ type: "text", text: "Hi" },
			{ type: "file", mime: "image/png", url: "data:image/png;base64,AA", filename: "a.png" },
			{ type: "file", mime: "text/plain", url: "file:///a.txt" },
		]);
	});
});

describe("prepareText", () => {
	it("resolves mentions and finds a known slash command", async () => {
		const prepared = await prepareText("/review src", {
			getKnownCommandNames: () => ["review"],
			resolveParts: async (parts) => parts,
		});

		expect(prepared).toEqual({
			text: "/review src",
			textParts: [{ type: "text", text: "/review src" }],
			command: { name: "review", arguments: "src" },
		});
	});
});

describe("prepareQueuedPrompt", () => {
	it("fixes what the composer holds, with the model as kilo.core names it", async () => {
		const prompt = await prepareQueuedPrompt(message("Then add tests"), "ses_a", {
			getAgent: () => "code",
			getModel: () => ({ providerID: "acme", id: "deep-2", variant: "high" }),
			getSystem: () => "Be brief.",
		});

		expect(prompt).toEqual({
			text: "Then add tests",
			textParts: [{ type: "text", text: "Then add tests" }],
			attachmentParts: [],
			agent: "code",
			model: { aiProviderId: "acme", modelId: "deep-2" },
			variant: "high",
			system: "Be brief.",
		});
	});
});
