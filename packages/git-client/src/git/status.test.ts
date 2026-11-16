import { afterEach, describe, expect, it } from "vitest";
import { appendFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { createGitClient } from "../client.js";
import { AppFileStatusKind, GitStatusEntry, UnmergedEntrySummary } from "../models/status.js";
import {
	cleanupTestDirs,
	createTestDir,
	gitExec,
	initialize,
	makeCommit,
	noopLogger,
	setupFixtureRepository,
	switchTo,
} from "../test/util.js";
import type { IStatusResult } from "./status.js";

afterEach(cleanupTestDirs);

/** Generate a pseudo-random hexadecimal string for use in testing. */
function generateString(length = 32): string {
	return randomBytes(Math.ceil(length / 2))
		.toString("hex")
		.slice(0, length);
}

async function getStatusOrThrow(path: string): Promise<IStatusResult> {
	const status = await createGitClient({ path, logger: noopLogger }).status();
	if (status === null) {
		throw new Error(`'git status' failed for '${path}'`);
	}
	return status;
}

/**
 * Setup a repository and create a merge conflict with multiple files.
 *
 * The current branch will be 'other-branch' and the merged branch will be
 * 'master' in your test harness.
 *
 * The conflicted files will be 'foo', 'bar', and 'baz'.
 */
async function setupConflictedRepoWithMultipleFiles(): Promise<string> {
	const repoPath = await initialize("conflicted-multiple-files", "master");

	const firstCommit = {
		entries: [
			{ path: "foo", contents: "b0" },
			{ path: "bar", contents: "b0" },
		],
	};

	await makeCommit(repoPath, firstCommit);

	// create this branch starting from the first commit, but don't checkout it
	// because we want to create a divergent history
	await gitExec(["branch", "other-branch"], repoPath);

	const secondCommit = {
		entries: [
			{ path: "foo", contents: "b1" },
			{ path: "bar", contents: null },
			{ path: "baz", contents: "b1" },
			{ path: "cat", contents: "b1" },
		],
	};

	await makeCommit(repoPath, secondCommit);

	await switchTo(repoPath, "other-branch");

	const thirdCommit = {
		entries: [
			{ path: "foo", contents: "b2" },
			{ path: "bar", contents: "b2" },
			{ path: "baz", contents: "b2" },
			{ path: "cat", contents: "b2" },
		],
	};

	await makeCommit(repoPath, thirdCommit);

	await writeFile(join(repoPath, "dog"), "touch");

	await gitExec(["merge", "master"], repoPath);

	return repoPath;
}

describe("git/status", () => {
	describe("getStatus", () => {
		describe("with conflicted repo", () => {
			it("parses conflicted files without markers", async () => {
				const path = await setupConflictedRepoWithMultipleFiles();

				const status = await getStatusOrThrow(path);
				const files = status.workingDirectory.files;
				expect(files.length).toBe(5);
				expect(files.filter((f) => f.status.kind === AppFileStatusKind.Conflicted).length).toBe(4);

				const barFile = files.find((f) => f.path === "bar");
				expect(barFile).toBeDefined();
				expect(barFile?.status).toStrictEqual({
					kind: AppFileStatusKind.Conflicted,
					entry: {
						kind: "conflicted",
						action: UnmergedEntrySummary.DeletedByThem,
						us: GitStatusEntry.UpdatedButUnmerged,
						them: GitStatusEntry.Deleted,
						submoduleStatus: undefined,
					},
				});
			});

			it("parses conflicted files resulting from popping a stash", async () => {
				const path = await initialize("stash-pop-conflict", "master");
				const readme = join(path, "README.md");
				await writeFile(readme, "");
				await gitExec(["add", "README.md"], path);
				await gitExec(["commit", "-m", "initial commit"], path);

				// write a change to the readme into the stash
				await appendFile(readme, generateString());
				await gitExec(["stash"], path);

				// write a different change to the README and commit it
				await appendFile(readme, generateString());
				await gitExec(["commit", "-am", "later commit"], path);

				// pop the stash to introduce a conflict into the index
				await gitExec(["stash", "pop"], path);

				const status = await getStatusOrThrow(path);
				const files = status.workingDirectory.files;
				expect(files.length).toBe(1);

				const conflictedFiles = files.filter((f) => f.status.kind === AppFileStatusKind.Conflicted);
				expect(conflictedFiles.length).toBe(1);
			});
		});

		describe("with unconflicted repo", () => {
			it("parses changed files", async () => {
				const path = await setupFixtureRepository("test-repo");

				await writeFile(join(path, "README.md"), "Hi world\n");

				const status = await getStatusOrThrow(path);
				const files = status.workingDirectory.files;
				expect(files.length).toBe(1);

				const file = files[0];
				expect(file?.path).toBe("README.md");
				expect(file?.status.kind).toBe(AppFileStatusKind.Modified);
			});

			it("returns an empty array when there are no changes", async () => {
				const path = await setupFixtureRepository("test-repo");

				const status = await getStatusOrThrow(path);
				const files = status.workingDirectory.files;
				expect(files.length).toBe(0);
			});

			it("reflects renames", async () => {
				const path = await initialize("renames", "master");

				await writeFile(join(path, "foo"), "foo\n");

				await gitExec(["add", "foo"], path);
				await gitExec(["commit", "-m", "Initial commit"], path);
				await gitExec(["mv", "foo", "bar"], path);

				const status = await getStatusOrThrow(path);
				const files = status.workingDirectory.files;

				expect(files.length).toBe(1);
				expect(files[0]?.path).toBe("bar");
				expect(files[0]?.status).toStrictEqual({
					kind: AppFileStatusKind.Renamed,
					oldPath: "foo",
					renameIncludesModifications: false,
					submoduleStatus: undefined,
				});
			});

			it("reflects copies", async () => {
				const path = await setupFixtureRepository("copy-detection-status");

				// Git 2.18 now uses a new config value to handle detecting copies, so
				// users who have this enabled will see this. For reference, Desktop does
				// not enable this by default.
				await gitExec(["config", "status.renames", "copies"], path);

				await gitExec(["add", "."], path);

				const status = await getStatusOrThrow(path);
				const files = status.workingDirectory.files;

				expect(files.length).toBe(2);

				expect(files[0]?.status.kind).toBe(AppFileStatusKind.Modified);
				expect(files[0]?.path).toBe("CONTRIBUTING.md");

				expect(files[1]?.path).toBe("docs/OVERVIEW.md");
				expect(files[1]?.status).toStrictEqual({
					kind: AppFileStatusKind.Copied,
					oldPath: "CONTRIBUTING.md",
					submoduleStatus: undefined,
					renameIncludesModifications: false,
				});
			});

			it("returns null for directory without a .git directory", async () => {
				const path = await createTestDir("desktop-git-test-no-repo");
				const status = await createGitClient({ path, logger: noopLogger }).status();
				expect(status).toBeNull();
			});
		});

		describe("with submodules", () => {
			it("returns the submodule status", async () => {
				const path = await setupFixtureRepository("submodule-basic-setup");

				const submodulePath = join(path, "foo", "submodule");

				// The commit below needs an identity: CI runners have no ambient git
				// config and cannot auto-detect one, and a failed commit would only
				// surface as a still-dirty submodule.
				await gitExec(["config", "user.email", "some.user@email.com"], submodulePath);
				await gitExec(["config", "user.name", "Some User"], submodulePath);

				const checkSubmoduleChanges = async (changes: {
					modifiedChanges: boolean;
					untrackedChanges: boolean;
					commitChanged: boolean;
				}) => {
					const status = await getStatusOrThrow(path);
					const files = status.workingDirectory.files;
					expect(files.length).toBe(1);

					const file = files[0];
					expect(file?.path).toBe("foo/submodule");
					expect(file?.status.kind).toBe(AppFileStatusKind.Modified);
					expect(file?.status.submoduleStatus?.modifiedChanges).toBe(changes.modifiedChanges);
					expect(file?.status.submoduleStatus?.untrackedChanges).toBe(changes.untrackedChanges);
					expect(file?.status.submoduleStatus?.commitChanged).toBe(changes.commitChanged);
				};

				// Modify README.md file. Now the submodule has modified changes.
				await writeFile(join(submodulePath, "README.md"), "hello world\n");
				await checkSubmoduleChanges({
					modifiedChanges: true,
					untrackedChanges: false,
					commitChanged: false,
				});

				// Create untracked file in submodule. Now the submodule has both
				// modified and untracked changes.
				await writeFile(join(submodulePath, "test"), "test\n");
				await checkSubmoduleChanges({
					modifiedChanges: true,
					untrackedChanges: true,
					commitChanged: false,
				});

				// Commit the changes within the submodule. Now the submodule has commit
				// changes.
				await gitExec(["add", "."], submodulePath);
				const commit = await gitExec(["commit", "-m", "changes"], submodulePath);
				expect(commit.exitCode, commit.stderr).toBe(0);
				await checkSubmoduleChanges({
					modifiedChanges: false,
					untrackedChanges: false,
					commitChanged: true,
				});
			});
		});
	});
});
