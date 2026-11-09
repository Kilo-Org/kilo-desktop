import { describe, expect, it } from "vitest";
import { processFile, type FileDiffMetadata } from "@pierre/diffs";

import { createDiffFilesLoader } from "./diff-files-loader.js";

const CHANGE_PATCH = `diff --git a/file.txt b/file.txt
index 1111111..2222222 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new
`;

function fileDiffFor(patchText: string): FileDiffMetadata {
	const fileDiff = processFile(patchText, { isGitDiff: true });
	if (fileDiff == null) {
		throw new Error(`test setup: could not parse patch\n${patchText}`);
	}
	return fileDiff;
}

type GetDiffContentsRequest = { directory: string; path: string; oldPath?: string };

function createLoader(
	getDiffContents: (args: GetDiffContentsRequest) => {
		oldContents: string | null;
		newContents: string | null;
	},
) {
	const recordedRequests: GetDiffContentsRequest[] = [];
	return {
		loader: createDiffFilesLoader(async (args) => {
			recordedRequests.push(args);
			return getDiffContents(args);
		}, "/workspace/project"),
		recordedRequests,
	};
}

describe("createDiffFilesLoader", () => {
	it("maps a change diff to both files", async () => {
		const { loader, recordedRequests } = createLoader(() => ({
			oldContents: "the old text",
			newContents: "the new text",
		}));

		const loaded = await loader(fileDiffFor(CHANGE_PATCH));

		expect(loaded).toEqual({
			oldFile: { name: "file.txt", contents: "the old text" },
			newFile: { name: "file.txt", contents: "the new text" },
		});
		expect(recordedRequests).toEqual([{ directory: "/workspace/project", path: "file.txt" }]);
	});

	it("passes oldPath and names the old file prevName for rename-changed", async () => {
		const renameChangedPatch = `diff --git a/old-name.txt b/new-name.txt
similarity index 90%
rename from old-name.txt
rename to new-name.txt
index 1111111..2222222 100644
--- a/old-name.txt
+++ b/new-name.txt
@@ -1 +1 @@
-old
+new
`;
		const { loader, recordedRequests } = createLoader(() => ({
			oldContents: "the old text",
			newContents: "the new text",
		}));
		const fileDiff = fileDiffFor(renameChangedPatch);
		expect(fileDiff.type).toBe("rename-changed");

		const loaded = await loader(fileDiff);

		expect(loaded).toEqual({
			oldFile: { name: "old-name.txt", contents: "the old text" },
			newFile: { name: "new-name.txt", contents: "the new text" },
		});
		expect(recordedRequests).toEqual([
			{ directory: "/workspace/project", path: "new-name.txt", oldPath: "old-name.txt" },
		]);
	});

	it("returns oldFile null for rename-pure", async () => {
		const renamePurePatch = `diff --git a/old-name.txt b/new-name.txt
similarity index 100%
rename from old-name.txt
rename to new-name.txt
`;
		const { loader } = createLoader(() => ({
			oldContents: "the old text",
			newContents: "the new text",
		}));
		const fileDiff = fileDiffFor(renamePurePatch);
		expect(fileDiff.type).toBe("rename-pure");

		const loaded = await loader(fileDiff);

		expect(loaded).toEqual({
			oldFile: null,
			newFile: { name: "new-name.txt", contents: "the new text" },
		});
	});

	it("throws when a required side comes back null", async () => {
		const nullOld = createLoader(() => ({ oldContents: null, newContents: "the new text" }));
		await expect(nullOld.loader(fileDiffFor(CHANGE_PATCH))).rejects.toThrow(/file\.txt/);

		const nullNew = createLoader(() => ({ oldContents: "the old text", newContents: null }));
		await expect(nullNew.loader(fileDiffFor(CHANGE_PATCH))).rejects.toThrow(/file\.txt/);
	});
});
