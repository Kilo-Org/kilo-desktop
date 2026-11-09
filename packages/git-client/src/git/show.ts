import type { IGitBufferExecutionOptions, IGitBufferResult } from "./core.js";
import { isMaxBufferExceededError } from "./core.js";
import { GitErrorCode } from "../exec/errors.js";
import { DEFAULT_FILE_CONTENTS_MAX_BYTES, GitFileTooLargeError } from "./file-contents.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (buffer overload). */
export type ShowExec = (
	args: string[],
	name: string,
	options: IGitBufferExecutionOptions,
) => Promise<IGitBufferResult>;

export interface GetBlobContentsOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
	/** Commitish whose tree the blob is read from, e.g. `HEAD`. */
	readonly commitish: string;
	/** Repository-root-relative path of the blob. */
	readonly path: string;
	/** Blob size limit in bytes. Larger blobs throw. Default 50 MiB. */
	readonly maxBytes?: number;
}

/**
 * Retrieve the raw contents of a blob from the repository at the given
 * commitish, via `git show <commitish>:<path>` (buffered).
 *
 * Resolves `null` when the path is not in the commitish's tree (new or
 * untracked files, unborn HEAD) — the three "absent" git errors below are
 * expected outcomes, not failures. Anything else (not a repository, unknown
 * commitish, …) throws.
 */
export async function getBlobContents(
	exec: ShowExec,
	options: GetBlobContentsOptions,
): Promise<Buffer | null> {
	try {
		const result = await exec(
			["show", `${options.commitish}:${options.path}`],
			"get-blob-contents",
			{
				...(options.cwd ? { cwd: options.cwd } : {}),
				encoding: "buffer",
				maxBuffer: options.maxBytes ?? DEFAULT_FILE_CONTENTS_MAX_BYTES,
				expectedErrors: new Set([
					GitErrorCode.PathExistsButNotInRef,
					GitErrorCode.PathDoesNotExist,
					GitErrorCode.InvalidObjectName,
				]),
			},
		);
		if (result.gitError !== null) {
			return null;
		}
		return result.stdout;
	} catch (error) {
		if (isMaxBufferExceededError(error)) {
			throw new GitFileTooLargeError("old", options.path);
		}
		throw error;
	}
}
