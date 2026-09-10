import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { createGitClient } from "../client.js";
import {
	cleanupTestDirs,
	createTestDir,
	gitExec,
	initialize,
	makeCommit,
	noopLogger,
} from "../test/util.js";
import { createWorkingDirectoryPatch, type PatchExec } from "./diff.js";
import type { GitPatchFile } from "./diff.js";

afterEach(cleanupTestDirs);

async function createPatchOrThrow(
	repoPath: string,
	options?: { cwd?: string; commitish?: string; tempDir?: string },
) {
	const patch = await createGitClient({
		path: repoPath,
		logger: noopLogger,
	}).createWorkingDirectoryPatch(options);
	if (patch === null) {
		throw new Error(`expected a patch for '${repoPath}'`);
	}
	return patch;
}

async function readPatchText(patch: GitPatchFile): Promise<string> {
	return readFile(patch.patchPath, "utf8");
}

async function removePatchFile(patch: GitPatchFile): Promise<void> {
	await rm(patch.patchPath, { force: true });
}

async function leftoverIndexDirs(): Promise<string[]> {
	return (await readdir(tmpdir())).filter((entry) => entry.startsWith("git-client-index-"));
}

describe("createWorkingDirectoryPatch", () => {
	it("diffs a new file as an all-additions hunk", async () => {
		const repoPath = await initialize("new-file");
		await makeCommit(repoPath, { entries: [{ path: "base.txt", contents: "base\n" }] });
		await writeFile(
			join(repoPath, "new-file.md"),
			"Lorem ipsum dolor sit amet,\nconsectetur adipiscing elit.\n",
		);

		const patch = await createPatchOrThrow(repoPath);
		expect(await readPatchText(patch)).toContain("diff --git a/new-file.md b/new-file.md");
		expect(await readPatchText(patch)).toContain("@@ -0,0 +1,2 @@");
		expect(await readPatchText(patch)).toContain("+Lorem ipsum dolor sit amet,");
		await removePatchFile(patch);
	});

	it("diffs a modified file with deletion then addition lines", async () => {
		const repoPath = await initialize("modified-file");
		await makeCommit(repoPath, {
			entries: [{ path: "file.txt", contents: "one\ntwo\nthree\nfour\n" }],
		});
		await writeFile(join(repoPath, "file.txt"), "one\nTWO\nfour\nfive\n");

		const text = await readPatchText(await createPatchOrThrow(repoPath));
		expect(text).toContain("-two");
		expect(text).toContain("-three");
		expect(text).toContain("+TWO");
		expect(text).toContain("+five");
	});

	it("still diffs a file that was staged and then modified again", async () => {
		const repoPath = await initialize("staged-then-modified");
		await makeCommit(repoPath, { entries: [{ path: "file.txt", contents: "original\n" }] });
		await writeFile(join(repoPath, "file.txt"), "staged\n");
		await gitExec(["add", "file.txt"], repoPath);
		await writeFile(join(repoPath, "file.txt"), "staged and modified\n");

		const text = await readPatchText(await createPatchOrThrow(repoPath));
		expect(text).toContain("-original");
		expect(text).toContain("+staged and modified");
	});

	it("reports binary files as differing", async () => {
		const repoPath = await initialize("binary-file");
		await makeCommit(repoPath, {
			entries: [{ path: "image.bin", contents: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) }],
		});
		await writeFile(join(repoPath, "image.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]));

		const text = await readPatchText(await createPatchOrThrow(repoPath));
		expect(text).toContain("diff --git a/image.bin b/image.bin");
		expect(text).toContain("Binary files");
		expect(text).toContain("differ");
	});

	it("emits rename headers with zero hunks for a pure rename", async () => {
		const repoPath = await initialize("pure-rename");
		await makeCommit(repoPath, { entries: [{ path: "foo", contents: "foo\n" }] });
		await gitExec(["mv", "foo", "bar"], repoPath);

		const text = await readPatchText(await createPatchOrThrow(repoPath));
		expect(text).toContain("diff --git a/foo b/bar");
		expect(text).toContain("rename from foo");
		expect(text).toContain("rename to bar");
		expect(text).not.toContain("@@");
	});

	it("shows only the modification hunks for a renamed and modified file", async () => {
		const repoPath = await initialize("rename-and-modify");
		const original = ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"];
		await makeCommit(repoPath, {
			entries: [{ path: "foo", contents: `${original.join("\n")}\n` }],
		});
		await gitExec(["mv", "foo", "bar"], repoPath);
		await writeFile(join(repoPath, "bar"), `${original.join("\n")}\nline 7\n`);

		const text = await readPatchText(await createPatchOrThrow(repoPath));
		// Desktop's warning: without rename detection through the staged
		// machinery this would degrade to a diff with only additions.
		expect(text).toContain("rename from foo");
		expect(text).toContain("rename to bar");
		expect(text).toContain("+line 7");
		// Only the modification: the unchanged lines must not reappear as
		// additions.
		expect(text).not.toContain("+line 1");
	});

	it("handles an unborn repository with mixed state", async () => {
		const repoPath = await initialize("unborn-mixed-state");
		await writeFile(join(repoPath, "foo"), "WRITING THE FIRST LINE\n");
		await gitExec(["add", "foo"], repoPath);
		await writeFile(join(repoPath, "foo"), "WRITING OVER THE TOP\n");

		const text = await readPatchText(await createPatchOrThrow(repoPath));
		expect(text).toContain("new file mode");
		expect(text).toContain("@@ -0,0 +1 @@");
		expect(text).toContain("+WRITING OVER THE TOP");
		expect(text).not.toContain("-WRITING THE FIRST LINE");
	});

	it("shows a whole-file rewrite for an LF to CRLF line-ending change", async () => {
		const repoPath = await initialize("line-endings");
		const filePath = join(repoPath, "foo");
		const crlf = "\r\n";
		await writeFile(
			filePath,
			`WRITING MANY LINES ${crlf} USING THIS LINE ENDING ${crlf} TO SHOW THAT GIT${crlf} WILL INSERT IT WITHOUT CHANGING THING ${crlf} HA HA BUSINESS`,
		);
		await gitExec(["add", "foo"], repoPath);
		await gitExec(["commit", "-m", "commit first file with CRLF"], repoPath);

		// Change the on-the-fly conversion config like Desktop's test; the
		// working tree bytes have not been rewritten, only git's view of them.
		await gitExec(["config", "core.autocrlf", "true"], repoPath);
		await writeFile(filePath, `WRITING MANY LINES \n\n USING THIS LINE ENDING \n\n`);

		const text = await readPatchText(await createPatchOrThrow(repoPath));
		expect(text).toContain("@@");
	});

	it("preserves unicode content exactly", async () => {
		const repoPath = await initialize("unicode");
		const testString = "here are some cool characters: • é  漢字";
		await writeFile(join(repoPath, "foo"), testString);

		const text = await readPatchText(await createPatchOrThrow(repoPath));
		expect(text).toContain(`+${testString}`);
	});

	it("captures the complete diff and never touches the real index", async () => {
		const repoPath = await initialize("complete-diff");
		await makeCommit(repoPath, {
			entries: [
				{ path: "staged.txt", contents: "original\n" },
				{ path: "unstaged.txt", contents: "original\n" },
			],
		});
		await writeFile(join(repoPath, "staged.txt"), "change A\n");
		await gitExec(["add", "staged.txt"], repoPath);
		await writeFile(join(repoPath, "unstaged.txt"), "change B\n");
		await writeFile(join(repoPath, "untracked.txt"), "change C\n");

		// Warm the real index's stat cache first: a plain `git status` writes
		// refreshed stat info opportunistically, which would otherwise make
		// the byte-identity comparison below flake for reasons unrelated to
		// the patch machinery.
		await gitExec(["status", "--porcelain=2", "-z"], repoPath);
		const indexBefore = await readFile(join(repoPath, ".git", "index"));
		const statusBefore = await gitExec(["status", "--porcelain=2", "-z"], repoPath);

		const patch = await createPatchOrThrow(repoPath);
		const text = await readPatchText(patch);
		expect(text).toContain("diff --git a/staged.txt b/staged.txt");
		expect(text).toContain("+change A");
		expect(text).toContain("diff --git a/unstaged.txt b/unstaged.txt");
		expect(text).toContain("+change B");
		expect(text).toContain("diff --git a/untracked.txt b/untracked.txt");
		expect(text).toContain("+change C");
		await removePatchFile(patch);

		// Core invariant: only change A remains staged, and the real index
		// file is byte-identical.
		const indexAfter = await readFile(join(repoPath, ".git", "index"));
		expect(indexAfter.equals(indexBefore)).toBe(true);
		const statusAfter = await gitExec(["status", "--porcelain=2", "-z"], repoPath);
		expect(statusAfter.stdout).toBe(statusBefore.stdout);
	});

	it("stages tree-wide from a cwd subdirectory", async () => {
		const repoPath = await initialize("cwd-subdirectory");
		await mkdir(join(repoPath, "nested"));
		await makeCommit(repoPath, {
			entries: [{ path: "root.txt", contents: "root\n" }],
		});
		await writeFile(join(repoPath, "nested", "leaf.txt"), "leaf\n");

		const patch = await createPatchOrThrow(repoPath, { cwd: join(repoPath, "nested") });
		const text = await readPatchText(patch);
		expect(text).toContain("diff --git a/nested/leaf.txt b/nested/leaf.txt");
		await removePatchFile(patch);
	});

	it("returns null outside a git repository", async () => {
		const dir = await createTestDir("not-a-repo");
		const patch = await createGitClient({
			path: dir,
			logger: noopLogger,
		}).createWorkingDirectoryPatch();
		expect(patch).toBeNull();
	});

	it("throws for an unknown explicit commitish", async () => {
		const repoPath = await initialize("bad-commitish");
		await makeCommit(repoPath, { entries: [{ path: "file.txt", contents: "x\n" }] });
		await writeFile(join(repoPath, "file.txt"), "y\n");

		await expect(createPatchOrThrow(repoPath, { commitish: "no-such-ref" })).rejects.toThrow(
			/no-such-ref/,
		);
	});

	it("rejects a dash-prefixed commitish before any git exec", async () => {
		// A dash-prefixed value would become an option to `rev-parse` /
		// `read-tree` (e.g. `--upload-pack=…`), so it must be rejected at
		// the entry, not by the spawned git.
		const exec = vi.fn(async () =>
			Promise.reject(new Error("exec must not run")),
		) as unknown as PatchExec;

		await expect(
			createWorkingDirectoryPatch(exec, { commitish: "--upload-pack=evil" }),
		).rejects.toThrow(/commitish/);
		expect(exec).not.toHaveBeenCalled();
	});

	it("produces an empty patch for a clean working tree", async () => {
		const repoPath = await initialize("clean");
		await makeCommit(repoPath, { entries: [{ path: "file.txt", contents: "x\n" }] });

		const patch = await createPatchOrThrow(repoPath);
		expect(patch.byteLength).toBe(0);
		const onDisk = await stat(patch.patchPath);
		expect(onDisk.size).toBe(0);
		await removePatchFile(patch);
	});

	it("throws when the patch exceeds the size cap", async () => {
		const repoPath = await initialize("too-large");
		await makeCommit(repoPath, { entries: [{ path: "file.txt", contents: "x\n" }] });
		await writeFile(join(repoPath, "file.txt"), "y\n");

		await expect(
			createGitClient({ path: repoPath, logger: noopLogger }).createWorkingDirectoryPatch({
				maxBytes: 4,
			}),
		).rejects.toThrow(/too large/);
	});

	it("removes the throwaway index dir but leaves the patch file to the caller", async () => {
		const repoPath = await initialize("cleanup");
		await makeCommit(repoPath, { entries: [{ path: "file.txt", contents: "x\n" }] });
		await writeFile(join(repoPath, "file.txt"), "y\n");

		const indexDirsBefore = await leftoverIndexDirs();
		const patch = await createPatchOrThrow(repoPath);
		const patchPath = patch.patchPath;
		expect((await stat(patchPath)).size).toBeGreaterThan(0);
		// The throwaway index dir never outlives the call.
		expect(await leftoverIndexDirs()).toEqual(indexDirsBefore);
		// The patch file does, until the caller removes it.
		await rm(patchPath, { force: true });
		await expect(stat(patchPath)).rejects.toMatchObject({ code: "ENOENT" });
		// Removing an already-removed patch file is a no-op.
		await rm(patchPath, { force: true });
	});

	it("writes the patch file into the provided tempDir", async () => {
		const baseDir = await createTestDir("patch-base");
		const repoPath = await initialize("tempdir-option");
		await makeCommit(repoPath, { entries: [{ path: "file.txt", contents: "x\n" }] });
		await writeFile(join(repoPath, "file.txt"), "y\n");

		const patch = await createPatchOrThrow(repoPath, { tempDir: baseDir });
		expect(patch.patchPath.startsWith(`${baseDir}${sep}`)).toBe(true);
		expect(patch.patchPath.endsWith(".patch")).toBe(true);
		await removePatchFile(patch);
	});
});
