import { describe, expect, it } from "vitest";

import type { SessionMessageInfo } from "@kilo-desktop/react-opencode-v2";

import type { ActivityPart } from "./tool-categories";
import { getGroupDiffStats, getPartDiffStats } from "./tool-diff-stats";

const toolPart = (
	toolName: string,
	args: Record<string, unknown>,
	overrides: Partial<ActivityPart> = {},
): ActivityPart => ({
	type: "tool-call",
	toolName,
	toolCallId: `call_${toolName}`,
	args,
	status: { type: "complete" },
	...overrides,
});

const BACKEND_DIFF = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1 +1,2 @@
-a
+b
+c
`;

/** Kilo's step holding a finished `edit` call that reports `patch` for x.ts. */
const messagesWithDiff = (id: string, patch: string): SessionMessageInfo[] => [
	{
		id: "msg_a",
		type: "assistant",
		agent: "code",
		model: { providerID: "kilo", id: "m" },
		time: { created: 1, completed: 2 },
		content: [
			{
				type: "tool",
				id,
				name: "edit",
				time: { created: 1 },
				state: {
					status: "completed",
					input: {},
					content: [{ type: "text", text: "Edit applied" }],
					metadata: { files: [{ file: "x.ts", patch, additions: 2, deletions: 1 }] },
				},
			},
		],
	},
];

describe("getPartDiffStats", () => {
	it("counts write content as pure additions", () => {
		const part = toolPart("write", { file_path: "/a.txt", content: "one\ntwo\n" });
		expect(getPartDiffStats(part, [])).toEqual({ added: 2, removed: 0 });
	});

	it("counts edit old/new string replacements", () => {
		const part = toolPart("edit", {
			file_path: "/a.txt",
			oldString: "one\ntwo\nthree\n",
			newString: "one\n2\nthree\nfour\n",
		});
		expect(getPartDiffStats(part, [])).toEqual({ added: 2, removed: 1 });
	});

	it("prefers the backend unified diff over args", () => {
		const part = toolPart(
			"edit",
			{ file_path: "/x.ts", oldString: "a", newString: "b" },
			{ toolCallId: "call_1" },
		);
		expect(getPartDiffStats(part, messagesWithDiff("call_1", BACKEND_DIFF))).toEqual({
			added: 2,
			removed: 1,
		});
	});

	it("counts patch additions and deletions from the patch text", () => {
		const part = toolPart("patch", {
			patchText: "*** Begin Patch\n*** Update File: x.ts\n@@\n-old\n+new\n+more\n*** End Patch",
		});
		expect(getPartDiffStats(part, [])).toEqual({ added: 2, removed: 1 });
	});

	it("skips in-flight calls whose args are still streaming", () => {
		const part = toolPart(
			"write",
			{ file_path: "/a.txt", content: "one\n" },
			{ status: { type: "running" } },
		);
		expect(getPartDiffStats(part, [])).toBeNull();
	});

	it("returns null for non-mutation tools", () => {
		expect(getPartDiffStats(toolPart("shell", { command: "ls" }), [])).toBeNull();
		expect(getPartDiffStats({ type: "text" }, [])).toBeNull();
	});

	it("returns null for mutation calls without content or with an empty patch", () => {
		expect(getPartDiffStats(toolPart("write", {}), [])).toBeNull();
		expect(getPartDiffStats(toolPart("edit", {}), [])).toBeNull();
		expect(getPartDiffStats(toolPart("patch", {}), [])).toBeNull();
		expect(
			getPartDiffStats(toolPart("patch", { patchText: "*** Begin Patch\n*** End Patch" }), []),
		).toBeNull();
	});
});

describe("getGroupDiffStats", () => {
	it("aggregates counts across the group's mutation parts", () => {
		const parts = [
			toolPart("write", { file_path: "/a.txt", content: "one\ntwo\n" }),
			{ type: "text" } as ActivityPart,
			toolPart("edit", {
				file_path: "/b.txt",
				oldString: "x\n",
				newString: "y\n",
			}),
		];
		expect(getGroupDiffStats(parts, [0, 1, 2], [])).toEqual({ added: 3, removed: 1 });
	});

	it("returns null when the group has no mutation parts", () => {
		const parts = [toolPart("shell", { command: "ls" })];
		expect(getGroupDiffStats(parts, [0], [])).toBeNull();
	});
});
