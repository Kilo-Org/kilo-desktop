import { describe, expect, it } from "vitest";

import {
	getEditNewString,
	getEditOldString,
	getToolFilePath,
	getToolUnifiedDiffFromParts,
	getWriteContent,
	hasEditStringArgs,
} from "./tool-diff-stats";

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

describe("reading tool args", () => {
	it("finds a file path, edit strings and written content by any of their names", () => {
		expect(getToolFilePath(undefined)).toBe("");
		expect(getToolFilePath({ file: "a.ts" })).toBe("a.ts");
		expect(getToolFilePath({})).toBe("");
		expect(getToolFilePath({ file_path: "/a.ts", filePath: "/b.ts" })).toBe("/a.ts");
		expect(getToolFilePath({ path: "c.ts", file: "d.ts" })).toBe("c.ts");
		expect(getEditOldString({ old_string: "b" })).toBe("b");
		expect(getEditNewString({ new_string: "d" })).toBe("d");
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
