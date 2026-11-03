import type { FileDiffContentsLoader } from "@pierre/diffs";

export type GetDiffContents = (input: {
	directory: string;
	path: string;
	oldPath?: string;
}) => Promise<{ oldContents: string | null; newContents: string | null }>;

/**
 * Hydration loader wiring pierre's hunk-expansion UI to the repository's
 * `getDiffContents`: pierre invokes it only for partial
 * change/rename diffs, and wrong content is worse than no expansion, so a
 * required side coming back null rejects (pierre catches, logs, and leaves
 * the diff unexpanded; the next click retries).
 *
 * No result cache by design: pierre dedupes in-flight loads per FileDiff and
 * flips `isPartial` to false on hydration, so a cache would only add
 * stale-content risk for millisecond-local calls.
 */
export function createDiffFilesLoader(
	getDiffContents: GetDiffContents,
	directory: string,
): FileDiffContentsLoader {
	return async (fileDiff) => {
		const { oldContents, newContents } = await getDiffContents({
			directory,
			path: fileDiff.name,
			...(fileDiff.prevName != null ? { oldPath: fileDiff.prevName } : {}),
		});

		// Pure renames have no old side in pierre's loaded-files shape.
		if (fileDiff.type === "rename-pure") {
			if (newContents == null) {
				throw new Error(`Missing new contents for "${fileDiff.name}".`);
			}
			return { oldFile: null, newFile: { name: fileDiff.name, contents: newContents } };
		}

		if (oldContents == null || newContents == null) {
			throw new Error(`Missing contents for "${fileDiff.name}".`);
		}
		return {
			oldFile: { name: fileDiff.prevName ?? fileDiff.name, contents: oldContents },
			newFile: { name: fileDiff.name, contents: newContents },
		};
	};
}
