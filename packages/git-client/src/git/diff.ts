import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { copyFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
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
	 * unborn HEAD (fresh repository) diffs against the empty tree.
	 */
	readonly commitish?: string;
	/** Patch size limit in bytes. Larger patches throw `GitPatchTooLargeError`. Default 10 MiB. */
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

const TEMP_INDEX_CONFIG = ["-c", "core.splitIndex=false"] as const;

const BYTES_PER_MIB = 1024 * 1024;

function formatMiB(bytes: number): string {
	return `${(bytes / BYTES_PER_MIB).toFixed(1)} MiB`;
}

/**
 * Copy `source` to `target`, carrying over its mtime. Git treats an entry
 * whose mtime is not older than the index file's as racily clean and
 * re-checks it by content; a fresh mtime on the copy would hide same-size
 * rewrites made in the same timestamp tick. The source is stat'ed before
 * the copy, and `Date` truncates to milliseconds, so any drift only makes
 * the copy look older — more entries re-checked, never fewer.
 *
 * Resolves `false` when `source` does not exist.
 */
async function copyIndex(source: string, target: string): Promise<boolean> {
	let sourceStats: Stats;
	try {
		sourceStats = await stat(source);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
	await copyFile(source, target);
	await utimes(target, sourceStats.atime, sourceStats.mtime);
	return true;
}

/** The working-tree patch exceeded the configured `maxBytes` limit. */
export class GitPatchTooLargeError extends Error {
	public constructor(
		public readonly byteLength: number,
		public readonly maxBytes: number,
	) {
		super(
			`The working directory diff is too large to display (${formatMiB(byteLength)}; the limit is ${formatMiB(maxBytes)}).`,
		);
		this.name = "GitPatchTooLargeError";
	}
}

/**
 * Produce the COMPLETE working-tree patch — staged plus unstaged plus
 * untracked, all measured against `commitish` (default `HEAD`) — without
 * ever touching the user's real index.
 *
 * How it works: every staging command runs with `GIT_INDEX_FILE` pointed at a
 * throwaway index inside a per-call temp directory. That temp index is seeded
 * with a copy of the repository's own index, mtime included (resolved through
 * `--absolute-git-dir`, so a linked worktree uses its own), then `add -A`
 * stages the whole working tree into it, and `diff --staged` (against
 * `commitish` when one is given) is written straight to a patch file via
 * `--output` (no stdout buffering). Because the index lives in the temp dir,
 * its lock file does too — concurrent calls never contend with the user's
 * own git operations. The throwaway index directory never outlives the call;
 * only the patch file does, until the caller removes it.
 *
 * Why copy instead of `read-tree`: `read-tree` leaves zeroed stat data, so
 * `add -A` would re-read and re-hash every tracked file on each call; the
 * copy carries the real stat cache, so only changed files are hashed. It
 * also makes the result match `git status`: skip-worktree / sparse and
 * assume-unchanged entries are respected, and force-added ignored files
 * appear. Without an index file (nothing ever staged) the seed is
 * `read-tree --empty`, which is exactly what git itself sees.
 *
 * Hardening: temp-index commands run with `core.splitIndex=false`, so writing
 * the temp index never creates `$GIT_DIR/sharedindex.*` (which the live
 * reload watcher would see as a change). Like every git-client command they
 * also run with `core.fsmonitor=false` (see `exec`), so a patch never
 * contacts or starts the user's fsmonitor daemon.
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
	const tempIndex = path.join(indexDir, "index");
	const cwdOption = options?.cwd ? { cwd: options.cwd } : {};
	const execWithTempIndex = (args: string[], name: string) =>
		exec([...TEMP_INDEX_CONFIG, ...args], name, {
			...cwdOption,
			env: { GIT_INDEX_FILE: tempIndex },
		});

	try {
		// One probe covers all three states: 0 = commitish resolves, 1 = unborn
		// HEAD / unknown ref (--quiet), 128 = not a repository.
		const probe = await exec(["rev-parse", "--verify", "--quiet", commitish], "verify-commitish", {
			...cwdOption,
			env: { GIT_INDEX_FILE: tempIndex },
			successExitCodes: new Set([0, 1, 128]),
		});
		if (probe.exitCode === 128) {
			return null;
		}
		if (probe.exitCode === 1 && options?.commitish !== undefined) {
			throw new Error(`Unknown revision: "${options.commitish}" does not resolve to a commit.`);
		}

		// Run without the temp `GIT_INDEX_FILE`: `--git-path index` would echo
		// the override back, and `exec` injects the default cwd, so only an
		// absolute path is usable here.
		const gitDir = await exec(["rev-parse", "--absolute-git-dir"], "resolve-git-dir", cwdOption);
		if (!(await copyIndex(path.join(gitDir.stdout.trim(), "index"), tempIndex))) {
			await execWithTempIndex(["read-tree", "--empty"], "seed-empty-temp-index");
		}

		// Tree-wide since git 2.0 regardless of the cwd subdirectory, and it
		// stages conflicted paths with their working-tree content as-is.
		await execWithTempIndex(["add", "-A"], "stage-working-tree");
		const base = options?.commitish === undefined ? [] : [options.commitish, "--"];
		await execWithTempIndex(
			["diff", "--staged", "--no-ext-diff", "--no-color", "-M", `--output=${patchPath}`, ...base],
			"write-working-tree-patch",
		);

		const byteLength = (await stat(patchPath)).size;
		if (byteLength > maxBytes) {
			throw new GitPatchTooLargeError(byteLength, maxBytes);
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
