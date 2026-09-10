import { cp, glob, mkdtemp, rename, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { expect } from "vitest";

import { exec } from "../exec/exec.js";
import type {
	GitBufferExecutionOptions,
	GitBufferResult,
	GitExecutionOptions,
	GitProcessContext,
	GitResult,
	GitStringExecutionOptions,
	GitStringResult,
} from "../exec/exec.js";
import { GitErrorCode } from "../exec/errors.js";
import { parseError } from "../exec/parse-error.js";
import { resolveGitBinary } from "../exec/resolve-git.js";
import type { GitLogger } from "../logger.js";

const directories: string[] = [];

/** Satisfies the `GitLogger` interface without touching any output sink. */
export const noopLogger: GitLogger = {
	error() {},
};

export async function createTestDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	directories.push(dir);
	return dir;
}

/** Called from each test file's `afterEach` to remove every temp directory. */
export function cleanupTestDirs(): void {
	for (const dir of directories.splice(0)) {
		// Retries absorb the EPERM/EBUSY Windows throws when a just-finished
		// (or just-killed, e.g. maxBuffer) git process still has the tree as
		// its cwd or an indexer holds a handle inside it. An exhausted retry
		// loop must not fail an otherwise-passing test — a leaked temp dir on
		// an ephemeral CI runner is harmless — so it downgrades to a warning.
		try {
			rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
		} catch (error) {
			console.warn(`cleanupTestDirs: could not remove ${dir}`, error);
		}
	}
}

export const testContext: GitProcessContext = {
	gitLocation: resolveGitBinary(undefined, process.env),
	env: {},
};

const context = testContext;

export function gitExec(
	args: string[],
	path: string,
	options?: GitStringExecutionOptions,
): Promise<GitStringResult>;
export function gitExec(
	args: string[],
	path: string,
	options: GitBufferExecutionOptions,
): Promise<GitBufferResult>;
export function gitExec(
	args: string[],
	path: string,
	options?: GitExecutionOptions,
): Promise<GitResult>;
export function gitExec(
	args: string[],
	path: string,
	options?: GitExecutionOptions,
): Promise<GitResult> {
	return exec(args, path, context, options);
}

export async function initialize(name: string, defaultBranch?: string): Promise<string> {
	const testRepoPath = await createTestDir(`desktop-git-test-${name}`);
	const branchArgs = defaultBranch !== undefined ? ["-b", defaultBranch] : [];
	await gitExec(["init", ...branchArgs], testRepoPath);
	await gitExec(["config", "user.email", '"some.user@email.com"'], testRepoPath);
	await gitExec(["config", "user.name", '"Some User"'], testRepoPath);
	return testRepoPath;
}

/**
 * Initialize a repository with a remote pointing to a local bare repository.
 * When `remotePath` is omitted, the bare remote repository is created.
 */
export async function initializeWithRemote(
	name: string,
	remotePath?: string,
	defaultBranch?: string,
): Promise<{ path: string; remote: string }> {
	let remote: string;
	if (remotePath !== undefined) {
		remote = remotePath;
	} else {
		remote = await createTestDir(`desktop-git-test-remote-${name}`);
		await gitExec(["init", "--bare"], remote);
	}

	const testRepoPath = await initialize(name, defaultBranch);
	await gitExec(["remote", "add", "origin", remote], testRepoPath);

	return { path: testRepoPath, remote };
}

/**
 * Copy the named fixture repository into a fresh temp directory, renaming
 * every fixture `_git` entry (matched with the recursive glob pattern)
 * to `.git` so it becomes a live repository.
 */
export async function setupFixtureRepository(name: string): Promise<string> {
	const fixturePath = join(import.meta.dirname, "fixtures", name);
	const testRepoPath = await createTestDir(`desktop-git-test-${name}`);
	await cp(fixturePath, testRepoPath, { recursive: true });

	for await (const entry of glob("**/_git", { cwd: testRepoPath })) {
		await rename(join(testRepoPath, entry), join(testRepoPath, dirname(entry), ".git"));
	}

	return testRepoPath;
}

export interface TreeEntry {
	/** The relative path of the file in the repository */
	readonly path: string;
	/**
	 * The contents associated with the current path.
	 *
	 * Use `null` to remove the file from the working directory before committing
	 */
	readonly contents: Buffer | string | null;
}

export interface Tree {
	readonly entries: ReadonlyArray<TreeEntry>;
	/**
	 * Optional commit message to pass to Git.
	 *
	 * If undefined, `'commit'` will be used.
	 */
	readonly commitMessage?: string;
}

/**
 * Make a commit to the repository by creating the specified files in the
 * working directory, staging all changes, and then committing with the
 * specified message.
 */
export async function makeCommit(repoPath: string, tree: Tree): Promise<void> {
	for (const entry of tree.entries) {
		if (entry.contents === null) {
			await gitExec(["rm", entry.path], repoPath);
		} else {
			await writeFile(join(repoPath, entry.path), entry.contents);
			await gitExec(["add", entry.path], repoPath);
		}
	}

	const message = tree.commitMessage ?? "commit";
	await gitExec(["commit", "-m", message], repoPath);
}

export async function switchTo(repoPath: string, branch: string): Promise<void> {
	const result = await gitExec(["rev-parse", "--verify", branch], repoPath);

	if (result.exitCode === 128) {
		// ref does not exist, checkout and create the branch
		await gitExec(["checkout", "-b", branch], repoPath);
	} else {
		// just switch to the branch
		await gitExec(["checkout", branch], repoPath);
	}
}

function getFriendlyGitError(gitError: GitErrorCode): string {
	return (
		(Object.keys(GitErrorCode) as Array<keyof typeof GitErrorCode>).find(
			(key) => GitErrorCode[key] === gitError,
		) ?? gitError.toString()
	);
}

export function assertHasGitError(result: GitResult, expectedError: GitErrorCode): void {
	const gitError = parseError(result.stderr.toString()) ?? parseError(result.stdout.toString());

	expect(
		gitError,
		`expected error ${getFriendlyGitError(expectedError)}, got ${
			gitError === null ? "none" : getFriendlyGitError(gitError)
		}`,
	).toBe(expectedError);
}
