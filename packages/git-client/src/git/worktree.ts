import { normalize } from "node:path";

import type { WorktreeEntry } from "../models/worktree.js";
import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type WorktreeExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

export interface WorktreeOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

export interface AddWorktreeOptions extends WorktreeOptions {
	/** Branch name used with `-b` (create a new branch at the worktree). */
	readonly createBranch?: string;
	/** Commit-ish to check out (branch name, ref, or SHA). Defaults to HEAD. */
	readonly commitish?: string;
}

export interface RemoveWorktreeOptions extends WorktreeOptions {
	/** Delete the worktree even when it is dirty or locked. */
	readonly force?: boolean;
}

/**
 * Parse `git worktree list --porcelain -z` output (ported from GitHub
 * Desktop). Blocks are separated by a double NUL, fields within a block by
 * a single NUL; block 0 is the main worktree.
 */
export function parseWorktreePorcelainOutput(stdout: string): ReadonlyArray<WorktreeEntry> {
	if (stdout.trim().length === 0) {
		return [];
	}

	const trimmed = stdout.endsWith("\u0000") ? stdout.slice(0, -1) : stdout;
	const blocks = trimmed.split("\u0000\u0000");
	const entries: WorktreeEntry[] = [];

	for (let i = 0; i < blocks.length; i++) {
		const lines = blocks[i]?.split("\0") ?? [];
		let path = "";
		let head = "";
		let branch: string | null = null;
		let isDetached = false;
		let isLocked = false;
		let isPrunable = false;

		for (const line of lines) {
			if (line.startsWith("worktree ")) {
				// Git for Windows writes forward-slash paths; normalizing keeps
				// path comparisons reliable across platforms.
				path = normalize(line.substring("worktree ".length));
			} else if (line.startsWith("HEAD ")) {
				head = line.substring("HEAD ".length);
			} else if (line.startsWith("branch ")) {
				branch = line.substring("branch ".length);
			} else if (line === "detached") {
				isDetached = true;
			} else if (line === "locked" || line.startsWith("locked ")) {
				isLocked = true;
			} else if (line === "prunable" || line.startsWith("prunable ")) {
				isPrunable = true;
			}
		}

		entries.push({
			path,
			head,
			branch,
			isDetached,
			type: i === 0 ? "main" : "linked",
			isLocked,
			isPrunable,
		});
	}

	return entries;
}

/**
 * List the worktrees of the repository containing the working directory.
 * The main worktree (block 0) is guaranteed first.
 */
export async function listWorktrees(
	exec: WorktreeExec,
	options?: WorktreeOptions,
): Promise<ReadonlyArray<WorktreeEntry>> {
	const result = await exec(["worktree", "list", "--porcelain", "-z"], "listWorktrees", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});

	return parseWorktreePorcelainOutput(result.stdout);
}

/**
 * Add a worktree at `worktreePath`. With `createBranch`, create a new
 * branch there (`-b`); with `commitish`, check it out (defaults to HEAD).
 */
export async function addWorktree(
	exec: WorktreeExec,
	worktreePath: string,
	options?: AddWorktreeOptions,
): Promise<void> {
	const args = ["worktree", "add"];

	if (options?.createBranch !== undefined) {
		args.push("-b", options.createBranch);
	}

	args.push(worktreePath);

	if (options?.commitish !== undefined) {
		args.push(options.commitish);
	}

	await exec(args, "addWorktree", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});
}

/**
 * Remove the worktree at `worktreePath`. With `force`, delete it even when
 * it is dirty or locked.
 */
export async function removeWorktree(
	exec: WorktreeExec,
	worktreePath: string,
	options?: RemoveWorktreeOptions,
): Promise<void> {
	const args = ["worktree", "remove"];

	if (options?.force) {
		args.push("--force");
	}
	args.push(worktreePath);

	await exec(args, "removeWorktree", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});
}

export type PruneWorktreeOptions = WorktreeOptions;

/**
 * Prune stale worktree registrations (`git worktree prune --expire now`).
 * Immediately expires any registration whose path no longer exists.
 */
export async function pruneWorktrees(
	exec: WorktreeExec,
	options?: PruneWorktreeOptions,
): Promise<void> {
	await exec(["worktree", "prune", "--expire", "now"], "pruneWorktrees", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
	});
}
