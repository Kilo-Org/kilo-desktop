import { describe, expect, it } from "vitest";
import { processFile, type FileDiffMetadata } from "@pierre/diffs";
import { FileTree } from "@pierre/trees";

import {
	appendFileDiffToGitDiffData,
	createGitDiffDataAccumulator,
	snapshotGitDiffTreeSource,
	takePendingGitDiffItems,
	type GitDiffDataAccumulator,
	type GitDiffTreeSource,
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

// The path-collision suite below is derived from Pierre's diffshub
// (apps/diffshub/test/diffsHubDataAccumulator.test.ts), Copyright 2025 Pierre Computer Company,
// Apache-2.0. Modified for Kilo Desktop; see THIRD_PARTY_NOTICES.md.
//
// A patch can hold a file and a directory at the same path (e.g. a deleted
// symlink replaced by a real directory); the file tree cannot.
const DELETED_SYMLINK_PATCH = `diff --git a/pkg/actions b/pkg/actions
deleted file mode 120000
index 7045925..0000000
--- a/pkg/actions
+++ /dev/null
@@ -1 +0,0 @@
-../lib/actions
\\ No newline at end of file
`;

const ADDED_DIRECTORY_FILE_PATCH = `diff --git a/pkg/actions/index.py b/pkg/actions/index.py
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/pkg/actions/index.py
@@ -0,0 +1 @@
+print("hi")
`;

const ADDED_SIBLING_FILE_PATCH = `diff --git a/pkg/zed.py b/pkg/zed.py
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/pkg/zed.py
@@ -0,0 +1 @@
+print("zed")
`;

function createTree(source: GitDiffTreeSource): FileTree {
	return new FileTree({
		flattenEmptyDirectories: false,
		gitStatus: source.gitStatus,
		initialExpansion: "open",
		paths: source.paths.slice(0, source.pathCount),
		sort: () => 0,
	});
}

// Mirrors GitDiffSidebar: linked snapshots append, anything else rebuilds.
function applySource(tree: FileTree, previous: GitDiffTreeSource, source: GitDiffTreeSource): void {
	if (source.previousSource !== previous) {
		tree.resetPaths(source.paths.slice(0, source.pathCount));
		tree.setGitStatus(source.gitStatus);
		return;
	}
	tree.batch(
		source.paths
			.slice(previous.pathCount, source.pathCount)
			.map((path) => ({ type: "add" as const, path })),
	);
	if (source.gitStatusPatch != null) tree.applyGitStatusPatch(source.gitStatusPatch);
}

function visibleRows(tree: FileTree): string[] {
	return tree.getVisibleRows(0, tree.getVisibleCount()).map((row) => row.path);
}

function accumulate(...patches: string[]): GitDiffDataAccumulator {
	const accumulator = createGitDiffDataAccumulator();
	for (const patch of patches) appendFileDiffToGitDiffData(accumulator, fileDiffOf(patch));
	return accumulator;
}

describe("GitDiffDataAccumulator file/directory path collisions", () => {
	it("gives a file replaced by a same-named directory a suffixed tree path", () => {
		const source = snapshotGitDiffTreeSource(
			accumulate(DELETED_SYMLINK_PATCH, ADDED_DIRECTORY_FILE_PATCH),
		);

		expect(source.paths).toEqual(["pkg/actions (file)", "pkg/actions/index.py"]);
		expect(source.gitStatus).toEqual([
			{ path: "pkg/actions (file)", status: "deleted" },
			{ path: "pkg/actions/index.py", status: "added" },
		]);
		// Item ids stay keyed by the real patch path.
		expect(source.pathToItemId.get("pkg/actions (file)")).toBe("pkg/actions");
		expect(() => createTree(source)).not.toThrow();
	});

	it("gives a file arriving after a same-named directory a suffixed tree path", () => {
		const source = snapshotGitDiffTreeSource(
			accumulate(ADDED_DIRECTORY_FILE_PATCH, DELETED_SYMLINK_PATCH),
		);

		expect(source.paths).toEqual(["pkg/actions/index.py", "pkg/actions (file)"]);
		expect(() => createTree(source)).not.toThrow();
	});

	it("rebuilds the tree in patch order after renaming a published file", () => {
		const accumulator = accumulate(DELETED_SYMLINK_PATCH, ADDED_SIBLING_FILE_PATCH);
		const first = snapshotGitDiffTreeSource(accumulator);
		const tree = createTree(first);

		appendFileDiffToGitDiffData(accumulator, fileDiffOf(ADDED_DIRECTORY_FILE_PATCH));
		const second = snapshotGitDiffTreeSource(accumulator);
		expect(second.previousSource).toBeUndefined();
		applySource(tree, first, second);

		expect(visibleRows(tree)).toEqual(visibleRows(createTree(second)));
		expect(tree.getItem("pkg/actions (file)")?.isDirectory()).toBe(false);
		expect(tree.getItem("pkg/actions/")?.isDirectory()).toBe(true);
		expect(second.pathToItemId.get("pkg/actions (file)")).toBe("pkg/actions");
	});

	it("keeps a published snapshot's paths intact after a later rename", () => {
		const accumulator = createGitDiffDataAccumulator();
		const empty = snapshotGitDiffTreeSource(accumulator);
		const tree = createTree(empty);
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(DELETED_SYMLINK_PATCH));
		const first = snapshotGitDiffTreeSource(accumulator);

		// The stream keeps appending before the tree renders `first`.
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(ADDED_DIRECTORY_FILE_PATCH));
		applySource(tree, empty, first);
		expect(visibleRows(tree)).toEqual(["pkg/", "pkg/actions"]);
		expect(first.pathToItemId.get("pkg/actions")).toBe("pkg/actions");
		expect(first.gitStatus).toEqual([{ path: "pkg/actions", status: "deleted" }]);

		const second = snapshotGitDiffTreeSource(accumulator);
		applySource(tree, first, second);
		expect(visibleRows(tree)).toEqual(visibleRows(createTree(second)));
	});

	it("streams a file renamed before its first publish as a plain append", () => {
		const accumulator = createGitDiffDataAccumulator();
		const first = snapshotGitDiffTreeSource(accumulator);
		const tree = createTree(first);
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(DELETED_SYMLINK_PATCH));
		appendFileDiffToGitDiffData(accumulator, fileDiffOf(ADDED_DIRECTORY_FILE_PATCH));
		const second = snapshotGitDiffTreeSource(accumulator);

		expect(second.previousSource).toBe(first);
		applySource(tree, first, second);
		expect(visibleRows(tree)).toEqual(visibleRows(createTree(second)));
	});
});
