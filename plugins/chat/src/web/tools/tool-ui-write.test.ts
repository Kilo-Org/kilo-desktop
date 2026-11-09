import { describe, expect, it } from "vitest";

import { hostnameFromUrl } from "./tool-ui-activity-row";
import { hasEditStringArgs } from "./tool-diff-stats";
import { resultText } from "./tool-ui-shared";
import { getToolFilePath, getToolUnifiedDiffFromParts } from "./tool-ui-file-mutation";
import { getEditNewString, getEditOldString } from "./tool-ui-edit";
import { getWriteContent } from "./tool-ui-write";

describe("getToolFilePath", () => {
	it("prefers file_path then filePath", () => {
		expect(getToolFilePath({ file_path: "/a/sample.txt" })).toBe("/a/sample.txt");
		expect(getToolFilePath({ filePath: "/b/sample.txt" })).toBe("/b/sample.txt");
		expect(getToolFilePath({ path: "c.txt", file: "d.txt" })).toBe("c.txt");
	});
});

describe("getWriteContent", () => {
	it("reads content or contents", () => {
		expect(getWriteContent({ content: "hello" })).toBe("hello");
		expect(getWriteContent({ contents: "world" })).toBe("world");
		expect(getWriteContent({})).toBe("");
	});
});

describe("getEditOldString / getEditNewString", () => {
	it("reads camelCase and snake_case edit args", () => {
		expect(getEditOldString({ oldString: "a" })).toBe("a");
		expect(getEditOldString({ old_string: "b" })).toBe("b");
		expect(getEditNewString({ newString: "c" })).toBe("c");
		expect(getEditNewString({ new_string: "d" })).toBe("d");
	});

	it("distinguishes explicitly empty edit strings from missing args", () => {
		expect(hasEditStringArgs({ old_string: "", new_string: "" })).toBe(true);
		expect(hasEditStringArgs({})).toBe(false);
	});
});

describe("getToolUnifiedDiffFromParts", () => {
	it("returns the tool metadata.diff for the matching call", () => {
		const diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
		const parts = [
			{
				type: "tool",
				callID: "call_1",
				tool: "edit",
				state: { metadata: { diff } },
			},
			{
				type: "tool",
				callID: "call_2",
				tool: "write",
				state: { metadata: { diff: "other" } },
			},
		];

		expect(getToolUnifiedDiffFromParts(parts, "call_1")).toBe(diff);
		expect(getToolUnifiedDiffFromParts(parts, "missing")).toBeUndefined();
	});
});

describe("resultText", () => {
	it("reads string results and output/stdout fields", () => {
		expect(resultText("plain")).toBe("plain");
		expect(resultText({ output: "out" })).toBe("out");
		expect(resultText({ stdout: "std" })).toBe("std");
		expect(resultText(null)).toBe("");
	});
});

describe("hostnameFromUrl", () => {
	it("extracts hostname or falls back to the raw string", () => {
		expect(hostnameFromUrl("https://example.com/path")).toBe("example.com");
		expect(hostnameFromUrl("not a url")).toBe("not a url");
	});
});
