import { describe, expect, it } from "vitest";
import type { SessionMessageAssistantTool } from "@kilo-desktop/react-opencode";

import { assistantMessage, idleMessage, tool, userMessage } from "../../test/kilo2/fixtures";
import { deriveRevertedUserRows, userMessageToComposerPrompt } from "./checkpoint-revert";

const diff = (file: string, additions: number, deletions: number) => ({
	file,
	patch: "",
	additions,
	deletions,
	status: "modified" as const,
});

const edit = (files: ReturnType<typeof diff>[]): SessionMessageAssistantTool => {
	const call = tool("edit", { path: "a.ts", oldString: "a", newString: "b" }, "Edited");
	return { ...call, state: { ...call.state, metadata: { files } } } as SessionMessageAssistantTool;
};

describe("deriveRevertedUserRows", () => {
	it("returns rows at and after the boundary by transcript position, not id order", () => {
		// "zzz-1" sorts after "aaa-2", so an id comparison would misplace the boundary.
		const messages = [
			userMessage("first", { id: "zzz-1" }),
			userMessage("second", { id: "aaa-2" }),
		];

		const rows = deriveRevertedUserRows("aaa-2", messages);

		expect(rows.map((row) => row.id)).toEqual(["aaa-2"]);
	});

	it("lists every user message from the boundary on, with its turn's file changes", () => {
		const messages = [
			userMessage("one", { id: "m-1" }),
			assistantMessage([edit([diff("a.ts", 1, 1)])]),
			userMessage("  two  ", { id: "m-2" }),
			assistantMessage([edit([diff("a.ts", 3, 1), diff("b.ts", 2, 0)])]),
			assistantMessage([tool("write", { path: "c.ts", content: "x" })]),
			idleMessage(),
			userMessage("three", { id: "m-3" }),
			assistantMessage([tool("read", { path: "a.ts" })]),
		];

		expect(deriveRevertedUserRows("m-2", messages)).toEqual([
			{ id: "m-2", text: "two", additions: 5, deletions: 1, hasDiffs: true },
			{ id: "m-3", text: "three", additions: 0, deletions: 0, hasDiffs: false },
		]);
	});

	it("counts a write without a diff as a change", () => {
		const messages = [
			userMessage("write it", { id: "m-1" }),
			assistantMessage([tool("write", { path: "c.ts", content: "x" })]),
		];

		expect(deriveRevertedUserRows("m-1", messages)[0]).toMatchObject({ hasDiffs: true });
	});

	it("returns an empty array without a boundary, or one not in the transcript", () => {
		const messages = [userMessage("one", { id: "m-1" })];
		expect(deriveRevertedUserRows(undefined, messages)).toEqual([]);
		expect(deriveRevertedUserRows("missing", messages)).toEqual([]);
	});
});

describe("userMessageToComposerPrompt", () => {
	it("restores the prompt's text and files as the transcript shows them", () => {
		const message = userMessage("  Look at this  ", {
			id: "msg_1",
			files: [
				{ data: "aGk=", mime: "image/png", source: { type: "inline" }, name: "shot.png" },
				{ data: "", mime: "text/plain", source: { type: "uri", uri: "file:///a.txt" } },
			],
		});

		expect(userMessageToComposerPrompt(message)).toEqual({
			text: "Look at this",
			attachments: [
				{
					id: "msg_1:0",
					type: "image",
					name: "shot.png",
					contentType: "image/png",
					content: [{ type: "image", image: "data:image/png;base64,aGk=" }],
				},
				{
					id: "msg_1:1",
					type: "file",
					name: "file",
					contentType: "text/plain",
					content: [{ type: "file", data: "file:///a.txt", mimeType: "text/plain" }],
				},
			],
		});
	});
});
