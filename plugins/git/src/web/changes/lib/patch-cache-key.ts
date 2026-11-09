/**
 * Worker-pool cache keys for streamed patch files.
 *
 * `@pierre/diffs` treats `cacheKey` as the content identity of a diff: the
 * module-level worker-pool singleton outlives this view's React lifecycle,
 * and cached highlight results are adopted on key match alone (render options
 * aside). A positional key (request id + stream index) is reissued after
 * every remount, so once the working tree moves on, the renderer adopts a
 * stale highlight AST and crashes in `DiffHunksRenderer.processDiffResult`.
 * Hashing the file's patch text keeps the key stable across remounts exactly
 * when reuse is valid: byte-identical content. The patch text always embeds
 * the file path in its headers, so name and language are hashed too.
 */
export function createPatchFileCacheKey(fileText: string): string {
	// FNV-1a 32-bit over UTF-16 code units.
	let hash = 0x811c9dc5;
	for (let index = 0; index < fileText.length; index += 1) {
		hash ^= fileText.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `git-diff:${fileText.length}:${(hash >>> 0).toString(36)}`;
}
