import { afterEach, describe, expect, it } from "vitest";
import { rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createGitClient } from "../client.js";
import { cleanupTestDirs, gitExec, initialize, makeCommit, noopLogger } from "../test/util.js";

afterEach(cleanupTestDirs);

describe("getFileContents", () => {
	it("returns the committed and on-disk contents for a modified file", async () => {
		const repoPath = await initialize("modified-contents");
		await makeCommit(repoPath, {
			entries: [{ path: "file.txt", contents: "committed contents\n" }],
		});
		await writeFile(join(repoPath, "file.txt"), "on-disk contents\n");

		const contents = await createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
			path: "file.txt",
		});

		expect(contents).toEqual({
			oldContents: "committed contents\n",
			newContents: "on-disk contents\n",
		});
	});

	it("reads the new side from disk, not the index, when staged content differs from on-disk content", async () => {
		const repoPath = await initialize("staged-then-modified-contents");
		await makeCommit(repoPath, {
			entries: [{ path: "file.txt", contents: "committed\n" }],
		});
		await writeFile(join(repoPath, "file.txt"), "staged\n");
		await gitExec(["add", "file.txt"], repoPath);
		await writeFile(join(repoPath, "file.txt"), "staged and modified\n");

		const contents = await createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
			path: "file.txt",
		});

		expect(contents).toEqual({ oldContents: "committed\n", newContents: "staged and modified\n" });
	});

	it("resolves null old contents for an untracked file", async () => {
		const repoPath = await initialize("untracked-contents");
		await makeCommit(repoPath, {
			entries: [{ path: "base.txt", contents: "base\n" }],
		});
		await writeFile(join(repoPath, "new-file.txt"), "never committed\n");

		const contents = await createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
			path: "new-file.txt",
		});

		expect(contents).toEqual({ oldContents: null, newContents: "never committed\n" });
	});

	it("resolves null new contents for a deleted file", async () => {
		const repoPath = await initialize("deleted-contents");
		await makeCommit(repoPath, {
			entries: [{ path: "file.txt", contents: "committed\n" }],
		});
		await rm(join(repoPath, "file.txt"));

		const contents = await createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
			path: "file.txt",
		});

		expect(contents).toEqual({ oldContents: "committed\n", newContents: null });
	});

	it("reads the old side via oldPath for a renamed file", async () => {
		const repoPath = await initialize("renamed-contents");
		await makeCommit(repoPath, {
			entries: [{ path: "old-name.txt", contents: "committed under the old name\n" }],
		});
		await gitExec(["mv", "old-name.txt", "new-name.txt"], repoPath);
		await writeFile(join(repoPath, "new-name.txt"), "committed under the old name\nrenamed\n");

		const contents = await createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
			path: "new-name.txt",
			oldPath: "old-name.txt",
		});

		expect(contents).toEqual({
			oldContents: "committed under the old name\n",
			newContents: "committed under the old name\nrenamed\n",
		});
	});

	it("resolves null old contents on an unborn HEAD", async () => {
		const repoPath = await initialize("unborn-contents");
		await writeFile(join(repoPath, "file.txt"), "not committed yet\n");

		const contents = await createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
			path: "file.txt",
		});

		expect(contents).toEqual({ oldContents: null, newContents: "not committed yet\n" });
	});

	// Windows: creating symlinks requires privileges the test runner may lack.
	it.skipIf(process.platform === "win32")("resolves null new contents for a symlink", async () => {
		const repoPath = await initialize("symlink-contents");
		await makeCommit(repoPath, {
			entries: [{ path: "target.txt", contents: "target\n" }],
		});
		await symlink("target.txt", join(repoPath, "link.txt"));

		const contents = await createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
			path: "link.txt",
		});

		expect(contents).toEqual({ oldContents: null, newContents: null });
	});

	it("throws GitFileTooLargeError when the blob exceeds maxBytes", async () => {
		const repoPath = await initialize("blob-too-large");
		await makeCommit(repoPath, {
			entries: [{ path: "file.txt", contents: "committed contents\n" }],
		});
		await writeFile(join(repoPath, "file.txt"), "ok\n");

		await expect(
			createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
				path: "file.txt",
				maxBytes: 4,
			}),
		).rejects.toMatchObject({ name: "GitFileTooLargeError", side: "old", path: "file.txt" });
	});

	it("throws GitFileTooLargeError when the working-tree file exceeds maxBytes", async () => {
		const repoPath = await initialize("working-tree-too-large");
		await makeCommit(repoPath, {
			entries: [{ path: "file.txt", contents: "x\n" }],
		});
		await writeFile(join(repoPath, "file.txt"), `${"y".repeat(100)}\n`);

		await expect(
			createGitClient({ path: repoPath, logger: noopLogger }).getFileContents({
				path: "file.txt",
				maxBytes: 4,
			}),
		).rejects.toMatchObject({ name: "GitFileTooLargeError", side: "new", path: "file.txt" });
	});
});
