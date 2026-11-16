import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import {
	cleanupTestDirs,
	createTestDir,
	gitExec,
	initialize,
	initializeWithRemote,
	makeCommit,
	noopLogger,
} from "../test/util.js";
import { checkRefFormat, getSymbolicRef } from "./refs.js";
import type { SymbolicRefExec } from "./refs.js";

afterEach(cleanupTestDirs);

/**
 * The real executor seam: a git-client bound to the probed path — the git
 * binary is the system boundary and is deliberately not mocked.
 */
function execFor(path: string): SymbolicRefExec {
	const client = createGitClient({ path, logger: noopLogger });
	return (args, name, options) => client.exec(args, name, options);
}

describe("git/refs", () => {
	describe("getSymbolicRef", () => {
		it("resolves HEAD to the current branch ref", async () => {
			const repoPath = await initialize("symbolic-ref-head", "main");

			await expect(getSymbolicRef(execFor(repoPath), "HEAD")).resolves.toBe("refs/heads/main");
		});

		it("returns null for a ref that is not symbolic", async () => {
			const repoPath = await initialize("symbolic-ref-not-symref", "main");

			await expect(getSymbolicRef(execFor(repoPath), "refs/heads/main")).resolves.toBe(null);
		});

		it("returns null for a ref that does not exist", async () => {
			const repoPath = await initialize("symbolic-ref-missing", "main");

			await expect(getSymbolicRef(execFor(repoPath), "refs/remotes/origin/HEAD")).resolves.toBe(
				null,
			);
		});

		it("resolves a remote HEAD symref", async () => {
			const { path: repoPath } = await initializeWithRemote("symbolic-ref-remote-head", undefined);
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# repo\n" }],
			});
			await gitExec(["push", "-u", "origin", "HEAD:main"], repoPath);
			await gitExec(["fetch", "origin"], repoPath);
			await gitExec(["remote", "set-head", "origin", "main"], repoPath);

			await expect(getSymbolicRef(execFor(repoPath), "refs/remotes/origin/HEAD")).resolves.toBe(
				"refs/remotes/origin/main",
			);
		});
	});

	describe("headBranch", () => {
		const headBranch = (path: string, cwd?: string) =>
			createGitClient({ path, logger: noopLogger }).headBranch(cwd === undefined ? {} : { cwd });

		it("reports an unborn branch without an upstream", async () => {
			const repoPath = await initialize("head-branch-unborn", "main");

			await expect(headBranch(repoPath)).resolves.toEqual({ name: "main", upstream: null });
		});

		it("reports the upstream of a tracking branch", async () => {
			const { path: repoPath } = await initializeWithRemote(
				"head-branch-tracking",
				undefined,
				"main",
			);
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "# repo\n" }] });
			await gitExec(["push", "-u", "origin", "HEAD:main"], repoPath);

			await expect(headBranch(repoPath)).resolves.toEqual({
				name: "main",
				upstream: "origin/main",
			});
		});

		it("still reports a configured upstream whose remote branch is gone", async () => {
			const { path: repoPath } = await initializeWithRemote("head-branch-gone", undefined, "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "# repo\n" }] });
			await gitExec(["config", "branch.main.remote", "origin"], repoPath);
			await gitExec(["config", "branch.main.merge", "refs/heads/deleted"], repoPath);

			await expect(headBranch(repoPath)).resolves.toEqual({
				name: "main",
				upstream: "origin/deleted",
			});
		});

		it("reports the branch checked out in a linked worktree", async () => {
			const repoPath = await initialize("head-branch-worktree", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "# repo\n" }] });
			const worktreePath = `${repoPath}-linked`;
			await gitExec(["worktree", "add", "-b", "kilo/linked", worktreePath], repoPath);

			try {
				await expect(headBranch(repoPath, worktreePath)).resolves.toEqual({
					name: "kilo/linked",
					upstream: null,
				});
			} finally {
				await gitExec(["worktree", "remove", "--force", worktreePath], repoPath);
			}
		});

		it("returns null for a detached HEAD", async () => {
			const repoPath = await initialize("head-branch-detached", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "# repo\n" }] });
			await gitExec(["checkout", "--detach"], repoPath);

			await expect(headBranch(repoPath)).resolves.toBe(null);
		});

		it("returns null outside a repository", async () => {
			const directory = await createTestDir("head-branch-not-a-repo");

			await expect(headBranch(directory)).resolves.toBe(null);
		});
	});

	describe("checkRefFormat", () => {
		it("returns true for a valid branch name", async () => {
			const repoPath = await initialize("check-ref-format-valid", "main");

			await expect(checkRefFormat(execFor(repoPath), "feature/my-branch")).resolves.toBe(true);
		});

		it("returns false for an invalid branch name with a leading dot segment", async () => {
			const repoPath = await initialize("check-ref-format-invalid", "main");

			await expect(checkRefFormat(execFor(repoPath), ".invalid")).resolves.toBe(false);
		});

		it("returns false for a name with double dots", async () => {
			const repoPath = await initialize("check-ref-format-dots", "main");

			await expect(checkRefFormat(execFor(repoPath), "bad..name")).resolves.toBe(false);
		});
	});
});
