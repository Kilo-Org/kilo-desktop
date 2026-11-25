import type { SessionMessageInfo } from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it } from "vitest";

import {
	getEditNewString,
	getEditOldString,
	getToolFilePath,
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
		const tool = (id: string, state: Record<string, unknown>) => ({
			type: "tool",
			id,
			name: "edit",
			time: { created: 1 },
			state,
		});
		const messages = [
			{ id: "msg_u", type: "user", text: "edit it", time: { created: 1 } },
			{
				id: "msg_a",
				type: "assistant",
				agent: "code",
				model: { providerID: "kilo", id: "m" },
				time: { created: 2 },
				content: [
					{ type: "text", text: "On it" },
					tool("c0", { status: "streaming", input: "{" }),
					tool("c2", { status: "running", input: {}, metadata: {} }),
					tool("c1", {
						status: "completed",
						input: {},
						content: [{ type: "text", text: "ok" }],
						metadata: {
							files: [
								{ file: "a.ts", patch: DIFF },
								{ file: "b.ts", patch: "" },
							],
						},
					}),
				],
			},
		] as unknown as SessionMessageInfo[];
		expect(getToolUnifiedDiff([], "c1")).toBeUndefined();
		expect(getToolUnifiedDiff(messages, "c0")).toBeUndefined();
		expect(getToolUnifiedDiff(messages, "c2")).toBeUndefined();
		expect(getToolUnifiedDiff(messages, "c1")).toBe(DIFF);
	});
});
