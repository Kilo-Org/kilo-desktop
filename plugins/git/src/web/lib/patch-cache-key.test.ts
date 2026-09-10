import { describe, expect, it } from "vitest";

import { createPatchFileCacheKey } from "./patch-cache-key.js";

const README_PATCH_V1 = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 line1
 line2
+added1
 line3
`;

// Same file, same stream position, but the working tree moved on between
// mounts of the Changes panel.
const README_PATCH_V2 = `diff --git a/README.md b/README.md
index 1111111..3333333 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,5 @@
 line1
 line2
+added1
+added2
 line3
`;

const OTHER_FILE_PATCH = `diff --git a/other.ts b/other.ts
index 4444444..5555555 100644
--- a/other.ts
+++ b/other.ts
@@ -1 +1 @@
-old
+new
`;

describe("createPatchFileCacheKey", () => {
	it("is stable for byte-identical patch text, so remounts reuse valid cached highlights", () => {
		expect(createPatchFileCacheKey(README_PATCH_V1)).toBe(createPatchFileCacheKey(README_PATCH_V1));
	});

	it("changes when the diff content changes, so a remount never adopts a stale highlight", () => {
		expect(createPatchFileCacheKey(README_PATCH_V1)).not.toBe(
			createPatchFileCacheKey(README_PATCH_V2),
		);
	});

	it("changes across files, so stream position is never shared state", () => {
		expect(createPatchFileCacheKey(README_PATCH_V1)).not.toBe(
			createPatchFileCacheKey(OTHER_FILE_PATCH),
		);
	});

	it("carries the git-diff namespace and content length", () => {
		expect(createPatchFileCacheKey(README_PATCH_V1)).toMatch(
			new RegExp(`^git-diff:${README_PATCH_V1.length}:`),
		);
	});
});
