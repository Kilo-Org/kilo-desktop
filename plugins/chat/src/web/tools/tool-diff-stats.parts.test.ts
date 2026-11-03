import { describe, expect, it } from "vitest";

import {
	getEditNewString,
	getEditOldString,
	getGroupDiffStats,
	getPartDiffStats,
	getToolFilePath,
	getToolUnifiedDiffFromParts,
	getWriteContent,
	hasEditStringArgs,
	sumFileDiffStats,
} from "./tool-diff-stats";
import type { ActivityPart } from "./tool-categories";

const DIFF = [
	"diff --git a/a.ts b/a.ts",
	"--- a/a.ts",
	"+++ b/a.ts",
	"@@ -1,2 +1,2 @@",
	" keep",
	"-old",
	"+new",
	"",
].join("\n");

const call = (
	toolName: string,
	args: unknown,
	extra: Partial<ActivityPart> = {},
): ActivityPart => ({
	type: "tool-call",
	toolName,
	toolCallId: "c1",
	args,
	status: { type: "complete" },
	...extra,
});

describe("reading tool args", () => {
	it("finds a file path, edit strings and written content by any of their names", () => {
		expect(getToolFilePath(undefined)).toBe("");
		expect(getToolFilePath({ file: "a.ts" })).toBe("a.ts");
		expect(getToolFilePath({})).toBe("");
		expect(getEditOldString({ old_text: "a" })).toBe("a");
		expect(getEditNewString(undefined)).toBe("");
		expect(hasEditStringArgs({ newText: "" })).toBe(true);
		expect(hasEditStringArgs({})).toBe(false);
		expect(getWriteContent(undefined)).toBe("");
		expect(getWriteContent({ contents: "x" })).toBe("x");
		expect(getWriteContent({})).toBe("");
	});

	it("takes the server's unified diff for the call when there is one", () => {
		const parts = [
			null,
			{ type: "text" },
			{ type: "tool", callID: "other", state: { metadata: { diff: "x" } } },
			{ type: "tool", id: "c0", state: null },
			{ type: "tool", callID: "c2", state: { metadata: null } },
			{ type: "tool", callID: "c1", state: { metadata: { diff: DIFF } } },
		];
		expect(getToolUnifiedDiffFromParts("nope", "c1")).toBeUndefined();
		expect(getToolUnifiedDiffFromParts(parts, "c0")).toBeUndefined();
		expect(getToolUnifiedDiffFromParts(parts, "c2")).toBeUndefined();
		expect(getToolUnifiedDiffFromParts(parts, "c1")).toBe(DIFF);
		expect(
			getToolUnifiedDiffFromParts(
				[{ type: "tool", callID: "c1", state: { metadata: { diff: "" } } }],
				"c1",
			),
		).toBeUndefined();
	});
});

describe("getPartDiffStats", () => {
	const serverDiff = [{ type: "tool", callID: "c1", state: { metadata: { diff: DIFF } } }];

	it("counts nothing for other tools, running calls and empty args", () => {
		expect(getPartDiffStats({ type: "text" }, [])).toBeNull();
		expect(getPartDiffStats(call("read", {}), [])).toBeNull();
		expect(getPartDiffStats(call("edit", {}, { status: { type: "running" } }), [])).toBeNull();
		expect(getPartDiffStats(call("apply_patch", {}), [])).toBeNull();
		expect(
			getPartDiffStats(call("apply_patch", { patchText: "*** Begin Patch\n*** End Patch" }), []),
		).toBeNull();
		expect(getPartDiffStats(call("write", {}), [])).toBeNull();
		expect(getPartDiffStats(call("edit", {}), [])).toBeNull();
	});

	it("prefers the server's diff, then the args", () => {
		expect(getPartDiffStats(call("edit", { oldString: "a" }), serverDiff)).toEqual({
			added: 1,
			removed: 1,
		});
		expect(getPartDiffStats(call("write", { content: "a\nb\n" }), [])).toEqual({
			added: 2,
			removed: 0,
		});
		expect(
			getPartDiffStats(call("edit", { newString: "a\n" }, { toolCallId: undefined }), []),
		).toEqual({
			added: 1,
			removed: 0,
		});
		expect(
			getPartDiffStats(call("apply_patch", { patchText: "*** Update File: a.ts\n-x\n+y\n+z" }), []),
		).toEqual({ added: 2, removed: 1 });
	});

	it("sums a group, skipping parts without stats", () => {
		const parts = [
			call("read", {}),
			call("write", { content: "a\n" }),
			call("edit", { newString: "b\n" }),
		];
		expect(getGroupDiffStats(parts, [0, 1, 2, 9], [])).toEqual({ added: 2, removed: 0 });
		expect(getGroupDiffStats(parts, [0], [])).toBeNull();
		expect(sumFileDiffStats([])).toBeNull();
	});
});
