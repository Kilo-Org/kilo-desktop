import { describe, expect, it } from "vitest";

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

const opencodePartsWithDiff = (callID: string, diff: string) => [
	{ type: "tool", callID, state: { metadata: { diff } } },
];

describe("getPartDiffStats", () => {
	it("counts write content as pure additions", () => {
		const part = toolPart("write", { file_path: "/a.txt", content: "one\ntwo\n" });
		expect(getPartDiffStats(part, undefined)).toEqual({ added: 2, removed: 0 });
	});

	it("counts edit old/new string replacements", () => {
		const part = toolPart("edit", {
			file_path: "/a.txt",
			oldString: "one\ntwo\nthree\n",
			newString: "one\n2\nthree\nfour\n",
		});
		expect(getPartDiffStats(part, undefined)).toEqual({ added: 2, removed: 1 });
	});

	it("prefers the backend unified diff over args", () => {
		const part = toolPart(
			"edit",
			{ file_path: "/x.ts", oldString: "a", newString: "b" },
			{ toolCallId: "call_1" },
		);
		const opencodeParts = opencodePartsWithDiff("call_1", BACKEND_DIFF);
		expect(getPartDiffStats(part, opencodeParts)).toEqual({ added: 2, removed: 1 });
	});

	it("counts apply_patch additions and deletions from the patch text", () => {
		const part = toolPart("apply_patch", {
			patchText: "*** Begin Patch\n*** Update File: x.ts\n@@\n-old\n+new\n+more\n*** End Patch",
		});
		expect(getPartDiffStats(part, undefined)).toEqual({ added: 2, removed: 1 });
	});

	it("skips in-flight calls whose args are still streaming", () => {
		const part = toolPart(
			"write",
			{ file_path: "/a.txt", content: "one\n" },
			{ status: { type: "running" } },
		);
		expect(getPartDiffStats(part, undefined)).toBeNull();
	});

	it("returns null for non-mutation tools", () => {
		expect(getPartDiffStats(toolPart("bash", { command: "ls" }), undefined)).toBeNull();
		expect(getPartDiffStats({ type: "text" }, undefined)).toBeNull();
	});

	it("returns null for mutation calls without content or with an empty patch", () => {
		expect(getPartDiffStats(toolPart("write", {}), undefined)).toBeNull();
		expect(getPartDiffStats(toolPart("edit", {}), undefined)).toBeNull();
		expect(getPartDiffStats(toolPart("apply_patch", {}), undefined)).toBeNull();
		expect(
			getPartDiffStats(
				toolPart("apply_patch", { patchText: "*** Begin Patch\n*** End Patch" }),
				undefined,
			),
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
		expect(getGroupDiffStats(parts, [0, 1, 2], undefined)).toEqual({ added: 3, removed: 1 });
	});

	it("returns null when the group has no mutation parts", () => {
		const parts = [toolPart("bash", { command: "ls" })];
		expect(getGroupDiffStats(parts, [0], undefined)).toBeNull();
	});
});
