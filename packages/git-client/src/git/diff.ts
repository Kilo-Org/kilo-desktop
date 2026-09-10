import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type PatchExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

export interface CreateWorkingDirectoryPatchOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
	/**
	 * Commitish the working tree is diffed against. Defaults to `HEAD`; an
	 * unborn HEAD (fresh repository) diffuses to the empty tree.
	 */
	readonly commitish?: string;
	/** Patch size limit in bytes. Larger patches throw. Default 10 MiB. */
	readonly maxBytes?: number;
	/** Base directory for the patch file. Defaults to `os.tmpdir()`. */
	readonly tempDir?: string;
}

/**
 * A patch file produced by {@link createWorkingDirectoryPatch}. The caller
 * owns the file's lifetime: consume it, then `rm` the `patchPath`.
 */
export interface GitPatchFile {
	/** Absolute path of the patch file (repo-root-relative `a/…`/`b/…` paths inside). */
	readonly patchPath: string;
	readonly byteLength: number;
}

/**
 * The 10 MiB cap bounds the WHOLE patch — no external tool sets this exact
 * number, so record the closest analogues instead of pretending lineage:
 * GitHub never hard-fails a diff view, it omits per-file diffs over 500 KB
 * raw and partially omits totals over 1 MB (our cap is 10x that); VS Code's
 * 50 MB `diffEditor.maxFileSize` limits per-file diff computation, a
 * per-file concern our hunk-expansion channel already caps separately at
 * 50 MiB per side. What this whole-patch cap actually buys: the renderer
 * retains every parsed `FileDiff` (~2-5x raw patch size), so 10 MiB bounds
 * the resident model at roughly 20-50 MB.
 */
export const DEFAULT_PATCH_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Produce the COMPLETE working-tree patch — staged plus unstaged plus
 * untracked, all measured against `commitish` (default `HEAD`) — without
 * ever touching the user's real index.
 *
 * How it works: every git invocation here runs with `GIT_INDEX_FILE` pointed
 * at a throwaway index inside a per-call temp directory. The machinery seeds
 * that temp index with `read-tree` (empty tree for an unborn HEAD), stages the
 * whole working tree into it with `add -A`, and writes the resulting
 * `diff --staged` straight to a patch file via `--output` (no stdout
 * buffering). Because the index lives in the temp dir, its lock file does
 * too — concurrent calls never contend with the user's own git operations.
 * The throwaway index directory never outlives the call; only the patch
 * file does, until the caller removes it.
 *
 * Return semantics:
 * - `null` — the working directory is not inside a git repository (the probe
 *   exits 128; mirrors `status()`).
 * - Throws for an unknown *explicit* commitish, for git failures, and when
 *   the patch exceeds `maxBytes` (the patch file is removed first).
 * - An empty working tree yields a patch file of zero bytes, not `null`.
 */
export async function createWorkingDirectoryPatch(
	exec: PatchExec,
	options?: CreateWorkingDirectoryPatchOptions,
): Promise<GitPatchFile | null> {
	const maxBytes = options?.maxBytes ?? DEFAULT_PATCH_MAX_BYTES;
	const commitish = options?.commitish ?? "HEAD";
	// A dash-prefixed value would be parsed as an option by `rev-parse` /
	// `read-tree` (e.g. `--upload-pack=…`), so reject it before any spawn.
	if (commitish.startsWith("-")) {
		throw new Error(`Invalid commitish: "${commitish}" must not start with "-".`);
	}
	const patchPath = path.join(
		options?.tempDir ?? tmpdir(),
		`git-client-patch-${randomUUID()}.patch`,
	);
	const indexDir = await mkdtemp(path.join(tmpdir(), "git-client-index-"));
	const execWithTempIndex = (args: string[], name: string) =>
		exec(args, name, {
			...(options?.cwd ? { cwd: options.cwd } : {}),
			env: { GIT_INDEX_FILE: path.join(indexDir, "index") },
		});

	try {
		// One probe covers all three states: 0 = commitish resolves, 1 = unborn
		// HEAD / unknown ref (--quiet), 128 = not a repository. Each exec is a
		// process spawn, so a second probe is deliberately avoided.
		const probe = await exec(["rev-parse", "--verify", "--quiet", commitish], "verify-commitish", {
			...(options?.cwd ? { cwd: options.cwd } : {}),
			env: { GIT_INDEX_FILE: path.join(indexDir, "index") },
			successExitCodes: new Set([0, 1, 128]),
		});
		if (probe.exitCode === 128) {
			return null;
		}
		if (probe.exitCode === 1) {
			if (options?.commitish !== undefined) {
				throw new Error(`Unknown revision: "${options.commitish}" does not resolve to a commit.`);
			}
			await execWithTempIndex(["read-tree", "--empty"], "seed-empty-temp-index");
		} else {
			await execWithTempIndex(["read-tree", commitish], "seed-temp-index");
		}

		// Tree-wide since git 2.0 regardless of the cwd subdirectory, and it
		// stages conflicted paths with their working-tree content as-is.
		await execWithTempIndex(["add", "-A"], "stage-working-tree");
		await execWithTempIndex(
			["diff", "--staged", "--no-ext-diff", "--no-color", "-M", `--output=${patchPath}`],
			"write-working-tree-patch",
		);

		const byteLength = (await stat(patchPath)).size;
		if (byteLength > maxBytes) {
			throw new Error(
				`The working directory diff is too large to display (${byteLength} bytes; the limit is ${maxBytes}).`,
			);
		}

		return { patchPath, byteLength };
	} catch (error) {
		await rm(patchPath, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
		throw error;
	} finally {
		// Retries absorb the EPERM/ENOTEMPTY Windows throws when a just-finished
		// git process (or an indexer) still holds a handle inside the tree —
		// the same pattern cleanupTestDirs uses for test repos.
		await rm(indexDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
			() => undefined,
		);
	}
}
