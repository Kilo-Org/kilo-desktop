import { parseDiffFromFile } from "@pierre/diffs";
import { describe, expect, it } from "vitest";

import { parseChatPatchFiles, withChatDiffCacheKey } from "./pierre-diff.js";

const PATCH = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n";
const SECOND_PATCH = "diff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-c\n+d\n";

describe("chat diff cache keys", () => {
	it("keeps the key stable for the same patch and changes it with the content", () => {
		const first = parseChatPatchFiles(PATCH, "call-1")[0];
		const repeated = parseChatPatchFiles(PATCH, "call-1")[0];
		const changed = parseChatPatchFiles(PATCH.replace("+b", "+c"), "call-1")[0];

		expect(first?.cacheKey).toBe(repeated?.cacheKey);
		expect(first?.cacheKey).not.toBe(changed?.cacheKey);
	});

	it("assigns a distinct cache key to every file in a multi-file patch", () => {
		const files = parseChatPatchFiles(`${PATCH}${SECOND_PATCH}`, "call-1");

		expect(files).toHaveLength(2);
		expect(files[0]?.cacheKey).not.toBe(files[1]?.cacheKey);
	});

	it("distinguishes fallback diffs when a tool call's content changes", () => {
		const first = withChatDiffCacheKey(
			parseDiffFromFile(null, { name: "x.txt", contents: "first" }),
			"call-1",
		);
		const changed = withChatDiffCacheKey(
			parseDiffFromFile(null, { name: "x.txt", contents: "second" }),
			"call-1",
		);

		expect(first.cacheKey).not.toBe(changed.cacheKey);
	});
});
