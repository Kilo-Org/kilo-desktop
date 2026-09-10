import { describe, expect, it } from "vitest";
import { processFile, type FileDiffMetadata } from "@pierre/diffs";

import {
	appendFileDiffToGitDiffData,
	createGitDiffDataAccumulator,
	snapshotGitDiffTreeSource,
	takePendingGitDiffItems,
} from "./diff-data-accumulator.js";

function fileDiffOf(patchText: string): FileDiffMetadata {
	const fileDiff = processFile(patchText, { isGitDiff: true });
	if (fileDiff == null) {
		throw new Error(`Fixture patch did not parse: ${patchText.slice(0, 60)}`);
	}
	return fileDiff;
}

const NEW_FILE_PATCH = `diff --git a/added.txt b/added.txt
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/added.txt
@@ -0,0 +1,2 @@
+one
+two
`;

const MODIFIED_FILE_PATCH = `diff --git a/modified.txt b/modified.txt
index 2222222..3333333 100644
--- a/modified.txt
+++ b/modified.txt
@@ -1,3 +1,2 @@
 context
-old line
-deleted line
+new line
`;

const DELETED_FILE_PATCH = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-goodbye
`;

const RECREATED_GONE_FILE_PATCH = `diff --git a/gone.txt b/gone.txt
new file mode 100644
index 0000000..7777777
--- /dev/null
+++ b/gone.txt
@@ -0,0 +1 @@
+back again
`;

const RENAMED_FILE_PATCH = `diff --git a/old-name.txt b/new-name.txt
similarity index 92%
rename from old-name.txt
rename to new-name.txt
index 5555555..6666666 100644
--- a/old-name.txt
+++ b/new-name.txt
@@ -1 +1 @@
-keep
+keep more
`;

describe("GitDiffDataAccumulator", () => {
	it("accumulates stats, items, and tree paths across change types", () => {
		const accumulator = createGitDiffDataAccumulator();
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(NEW_FILE_PATCH));
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(MODIFIED_FILE_PATCH));
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(DELETED_FILE_PATCH));
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(RENAMED_FILE_PATCH));

		expect(accumulator.items.map((item) => item.id)).toEqual([
			"added.txt",
			"modified.txt",
			"gone.txt",
			"new-name.txt",
		]);
		expect(accumulator.diffStats.fileCount).toBe(4);
		expect(accumulator.diffStats.addedLines).toBe(4);
		expect(accumulator.diffStats.deletedLines).toBe(4);
		expect(accumulator.paths).toEqual(["added.txt", "modified.txt", "gone.txt", "new-name.txt"]);

		const treeSource = snapshotGitDiffTreeSource(accumulator);
		expect(treeSource.gitStatus).toEqual([
			{ path: "added.txt", status: "added" },
			{ path: "modified.txt", status: "modified" },
			{ path: "gone.txt", status: "deleted" },
			{ path: "new-name.txt", status: "renamed" },
		]);
		expect(treeSource.previousSource).toBeUndefined();
	});

	it("hands pending items to the viewer once and links tree snapshots", () => {
		const accumulator = createGitDiffDataAccumulator();
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(NEW_FILE_PATCH));
		expect(accumulator.pendingItems).toHaveLength(1);
		const pending = takePendingGitDiffItems(accumulator);
		expect(pending.map((item) => item.id)).toEqual(["added.txt"]);
		expect(takePendingGitDiffItems(accumulator)).toEqual([]);

		const firstSource = snapshotGitDiffTreeSource(accumulator);
		expect(firstSource.gitStatusPatch).toBeUndefined();

		appendFileDiffToGitDiffData(accumulator, fileDiffOf(DELETED_FILE_PATCH));
		const secondSource = snapshotGitDiffTreeSource(accumulator);
		// Linked snapshot: the consumer may apply the delta instead of rebuilding.
		expect(secondSource.previousSource).toBe(firstSource);
		expect(secondSource.gitStatusPatch?.set).toEqual([{ path: "gone.txt", status: "deleted" }]);
	});

	it("renames the superseded item id when a path receives a second entry", () => {
		const accumulator = createGitDiffDataAccumulator();
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(NEW_FILE_PATCH));
		// The first entry was published (no longer pending), so the next entry
		// for the same path must move the old item off the canonical id.
		takePendingGitDiffItems(accumulator);
		const rename = appendFileDiffToGitDiffData(accumulator, fileDiffOf(NEW_FILE_PATCH));

		expect(rename).toEqual({ oldId: "added.txt", newId: "added.txt?previous" });
		// Upstream diffshub semantics: freeing the old id lets the newest
		// entry re-own the canonical id, so tree navigation stays path-stable.
		expect(accumulator.items[0]?.id).toBe("added.txt?previous");
		expect(accumulator.items[1]?.id).toBe("added.txt");
		expect(accumulator.pathToItemId.get("added.txt")).toBe("added.txt");
	});

	it("collapses a delete-then-recreate sequence into a single status", () => {
		const accumulator = createGitDiffDataAccumulator();
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(DELETED_FILE_PATCH));
		takePendingGitDiffItems(accumulator);
		snapshotGitDiffTreeSource(accumulator);

		// The same path reappears as an addition: the deleted status must be
		// removed so the tree does not show both badges.
		const rename = appendFileDiffToGitDiffData(accumulator, fileDiffOf(RECREATED_GONE_FILE_PATCH));
		expect(rename).toEqual({ oldId: "gone.txt", newId: "gone.txt?deleted" });

		// Ported diffshub semantics: a path that is deleted and then reappears
		// with a non-deleted entry is treated as back to neutral — the delete
		// badge is removed and no replacement status is recorded.
		const treeSource = snapshotGitDiffTreeSource(accumulator);
		expect(treeSource.gitStatus).toEqual([]);
		expect(treeSource.gitStatusPatch?.remove).toEqual(["gone.txt"]);
		expect(treeSource.gitStatusPatch?.set).toBeUndefined();
	});

	it("gives a real file named like a superseded id a unique id", () => {
		const accumulator = createGitDiffDataAccumulator();
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(DELETED_FILE_PATCH));
		takePendingGitDiffItems(accumulator);
		// Delete-then-recreate: the first entry moves onto "gone.txt?deleted".
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(RECREATED_GONE_FILE_PATCH));
		expect(accumulator.usedItemIds.has("gone.txt?deleted")).toBe(true);

		// A real file legitimately named "gone.txt?deleted" (legal on
		// macOS/Linux) must not collide with the superseded id.
		const realSupersededNamePatch = `diff --git a/gone.txt?deleted b/gone.txt?deleted
new file mode 100644
index 0000000..8888888
--- /dev/null
+++ b/gone.txt?deleted
@@ -0,0 +1 @@
+distinct file
`;
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(realSupersededNamePatch));
		const item = accumulator.items.at(-1);
		expect(item?.id).not.toBe("gone.txt?deleted");
		expect(accumulator.usedItemIds.has(item?.id ?? "")).toBe(true);
		// The tree keys the real path to that unique id.
		expect(accumulator.pathToItemId.get("gone.txt?deleted")).toBe(item?.id);
	});
});
