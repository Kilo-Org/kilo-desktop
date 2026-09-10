import { lstat, readFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { getBlobContents, type ShowExec } from "./show.js";

/** Per-side contents limit in bytes. Larger sides throw `GitFileTooLargeError`. */
export const DEFAULT_FILE_CONTENTS_MAX_BYTES = 50 * 1024 * 1024;

/** One side of a file's contents exceeded the configured `maxBytes` limit. */
export class GitFileTooLargeError extends Error {
	public constructor(
		/** Which side was too large. */
		public readonly side: "old" | "new",
		/** Repository-root-relative path of the file. */
		public readonly path: string,
	) {
		super(`The ${side} contents of "${path}" are too large to load.`);
		this.name = "GitFileTooLargeError";
	}
}

export interface GetFileContentsOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
	/**
	 * Commitish the old side is read from via `git show`. Defaults to `HEAD`;
	 * an unborn HEAD (fresh repository) resolves the old side to `null`.
	 */
	readonly commitish?: string;
	/** Repository-root-relative new path of the file. */
	readonly path: string;
	/** Repository-root-relative old path of the file (renames). */
	readonly oldPath?: string;
	/** Per-side size limit in bytes. Larger sides throw. Default 50 MiB. */
	readonly maxBytes?: number;
}

export interface WorkingTreeFileContents {
	/** Contents from `commitish` (raw blob), or `null` when absent there. */
	readonly oldContents: string | null;
	/** Working-tree contents, or `null` when the file is not on disk. */
	readonly newContents: string | null;
}

/**
 * Both sides of a working-tree file's contents, for diff hunk expansion:
 * the old side is the blob at `commitish` (default `HEAD`), the new side is
 * the file as it exists on disk.
 */
/**
 * Read the working-tree side. Only the "not there" outcomes and non-regular
 * files become `null` (deleted file, a parent directory replaced by a file,
 * symlink/FIFO/socket/device); any other fs error (`EACCES`, `EPERM`, …)
 * propagates. The `lstat` regular-file check keeps `readFile` from
 * following symlinks out of the repository or blocking on a FIFO.
 *
 * The size is checked before the read and re-checked on the returned string:
 * the re-check closes the stat→read window where the file grows past the
 * limit between the two.
 */
async function readWorkingTreeFile(
	absolutePath: string,
	repoRelativePath: string,
	maxBytes: number,
): Promise<string | null> {
	let stats: Stats | null = null;
	try {
		stats = await lstat(absolutePath);
	} catch (error) {
		const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return null;
		}
		throw error;
	}
	if (!stats.isFile()) {
		return null;
	}
	if (stats.size > maxBytes) {
		throw new GitFileTooLargeError("new", repoRelativePath);
	}
	const contents = await readFile(absolutePath, "utf8");
	if (Buffer.byteLength(contents) > maxBytes) {
		throw new GitFileTooLargeError("new", repoRelativePath);
	}
	return contents;
}

export async function getFileContents(
	exec: ShowExec,
	options: GetFileContentsOptions,
): Promise<WorkingTreeFileContents> {
	const cwd = options.cwd ?? process.cwd();
	const maxBytes = options.maxBytes ?? DEFAULT_FILE_CONTENTS_MAX_BYTES;
	const [oldContents, newContents] = await Promise.all([
		getBlobContents(exec, {
			cwd,
			commitish: options.commitish ?? "HEAD",
			path: options.oldPath ?? options.path,
			maxBytes,
		}),
		readWorkingTreeFile(join(cwd, options.path), options.path, maxBytes),
	]);
	return {
		oldContents: oldContents?.toString("utf8") ?? null,
		newContents,
	};
}
