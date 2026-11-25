import { describe, expect, it } from "vitest";

import { assistantMessage, tool, userMessage } from "../../test/kilo2/fixtures";
import {
	getEditNewString,
	getEditOldString,
	getToolFilePath,
	getToolFileDiffs,
	getToolUnifiedDiff,
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
		expect(getToolFilePath({ path: "/a.ts" })).toBe("/a.ts");
		expect(getToolFilePath({ file: "a.ts" })).toBe("a.ts");
		expect(getToolFilePath({})).toBe("");
		expect(getToolFilePath({ path: "/a.ts", filePath: "/b.ts" })).toBe("/a.ts");
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

	it("takes the server's file diffs for the call when there are any", () => {
		const fileDiff = { file: "a.ts", patch: DIFF, additions: 1, deletions: 1, status: "modified" };
		const edited = tool("edit", { path: "a.ts" }, "Edited", {
			state: {
				status: "completed",
				input: { path: "a.ts" },
				content: [{ type: "text", text: "Edited" }],
				metadata: { files: [fileDiff, { file: 3 }] } as never,
			},
		});
		const read = tool("read", { path: "a.ts" }, "contents");
		const messages = [userMessage("fix it"), assistantMessage([read]), assistantMessage([edited])];

		expect(getToolFileDiffs(messages, edited.id)).toEqual([fileDiff]);
		expect(getToolUnifiedDiff(messages, edited.id)).toBe(DIFF);
		expect(getToolUnifiedDiff(messages, read.id)).toBeUndefined();
		expect(getToolUnifiedDiff(messages, "missing")).toBeUndefined();
		expect(getToolUnifiedDiff([], edited.id)).toBeUndefined();
	});
});
