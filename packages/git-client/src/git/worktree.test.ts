import { realpath, rm, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import {
	cleanupTestDirs,
	createTestDir,
	gitExec,
	initialize,
	makeCommit,
	noopLogger,
} from "../test/util.js";
import { listWorktrees, parseWorktreePorcelainOutput } from "./worktree.js";
import type { WorktreeExec } from "./worktree.js";

afterEach(cleanupTestDirs);

describe("git/worktree", () => {
	describe("parseWorktreePorcelainOutput", () => {
		it("returns empty array for empty output", () => {
			expect(parseWorktreePorcelainOutput("")).toEqual([]);
			expect(parseWorktreePorcelainOutput("  \n  ")).toEqual([]);
		});

		it("parses a single main worktree", () => {
			const output =
				[
					"worktree /path/to/repo",
					"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
					"branch refs/heads/main",
				].join("\0") + "\0";

			const entries = parseWorktreePorcelainOutput(output);
			expect(entries).toHaveLength(1);
			expect(entries[0]).toEqual({
				path: normalize("/path/to/repo"),
				head: "abc1234abc1234abc1234abc1234abc1234abc123",
				branch: "refs/heads/main",
				isDetached: false,
				type: "main",
				isLocked: false,
				isPrunable: false,
			});
		});

		it("parses multiple worktrees", () => {
			const output =
				[
					[
						"worktree /path/to/repo",
						"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
						"branch refs/heads/main",
					].join("\0"),
					[
						"worktree /path/to/linked",
						"HEAD def5678def5678def5678def5678def5678def567",
						"branch refs/heads/feature",
					].join("\0"),
				].join("\0\0") + "\0";

			const entries = parseWorktreePorcelainOutput(output);
			expect(entries).toHaveLength(2);
			expect(entries[0]?.type).toBe("main");
			expect(entries[0]?.path).toBe(normalize("/path/to/repo"));
			expect(entries[1]?.type).toBe("linked");
			expect(entries[1]?.path).toBe(normalize("/path/to/linked"));
			expect(entries[1]?.branch).toBe("refs/heads/feature");
		});

		it("parses detached HEAD worktree", () => {
			const output =
				[
					[
						"worktree /path/to/repo",
						"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
						"branch refs/heads/main",
					].join("\0"),
					[
						"worktree /path/to/detached",
						"HEAD def5678def5678def5678def5678def5678def567",
						"detached",
					].join("\0"),
				].join("\0\0") + "\0";

			const entries = parseWorktreePorcelainOutput(output);
			expect(entries[1]?.isDetached).toBe(true);
			expect(entries[1]?.branch).toBeNull();
		});

		it("parses locked worktree", () => {
			const output =
				[
					[
						"worktree /path/to/repo",
						"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
						"branch refs/heads/main",
					].join("\0"),
					[
						"worktree /path/to/locked-wt",
						"HEAD def5678def5678def5678def5678def5678def567",
						"branch refs/heads/locked-branch",
						"locked",
					].join("\0"),
				].join("\0\0") + "\0";

			expect(parseWorktreePorcelainOutput(output)[1]?.isLocked).toBe(true);
		});

		it("parses locked worktree with reason", () => {
			const output =
				[
					[
						"worktree /path/to/repo",
						"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
						"branch refs/heads/main",
					].join("\0"),
					[
						"worktree /path/to/locked-wt",
						"HEAD def5678def5678def5678def5678def5678def567",
						"branch refs/heads/locked-branch",
						"locked reason why it is locked",
					].join("\0"),
				].join("\0\0") + "\0";

			expect(parseWorktreePorcelainOutput(output)[1]?.isLocked).toBe(true);
		});

		it("parses prunable worktree", () => {
			const output =
				[
					[
						"worktree /path/to/repo",
						"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
						"branch refs/heads/main",
					].join("\0"),
					[
						"worktree /path/to/prunable-wt",
						"HEAD def5678def5678def5678def5678def5678def567",
						"branch refs/heads/stale",
						"prunable gitdir file points to non-existent location",
					].join("\0"),
				].join("\0\0") + "\0";

			expect(parseWorktreePorcelainOutput(output)[1]?.isPrunable).toBe(true);
		});

		it("parses paths with spaces", () => {
			const output =
				[
					[
						"worktree /path/to/my repo",
						"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
						"branch refs/heads/main",
					].join("\0"),
					[
						"worktree /path/to/my other worktree",
						"HEAD def5678def5678def5678def5678def5678def567",
						"branch refs/heads/feature",
					].join("\0"),
				].join("\0\0") + "\0";

			const entries = parseWorktreePorcelainOutput(output);
			expect(entries[0]?.path).toBe(normalize("/path/to/my repo"));
			expect(entries[1]?.path).toBe(normalize("/path/to/my other worktree"));
		});

		it("parses worktree with locked and prunable flags combined", () => {
			const output =
				[
					[
						"worktree /path/to/repo",
						"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
						"branch refs/heads/main",
					].join("\0"),
					[
						"worktree /path/to/bad-wt",
						"HEAD def5678def5678def5678def5678def5678def567",
						"detached",
						"locked",
						"prunable",
					].join("\0"),
				].join("\0\0") + "\0";

			const entries = parseWorktreePorcelainOutput(output);
			expect(entries[1]?.isDetached).toBe(true);
			expect(entries[1]?.isLocked).toBe(true);
			expect(entries[1]?.isPrunable).toBe(true);
			expect(entries[1]?.branch).toBeNull();
		});

		it("parses paths with newlines", () => {
			const output =
				[
					[
						"worktree /path/to/my\nrepo",
						"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
						"branch refs/heads/main",
					].join("\0"),
					[
						"worktree /path/to/my\nother\nworktree",
						"HEAD def5678def5678def5678def5678def5678def567",
						"branch refs/heads/feature",
					].join("\0"),
				].join("\0\0") + "\0";

			const entries = parseWorktreePorcelainOutput(output);
			expect(entries[0]?.path).toBe(normalize("/path/to/my\nrepo"));
			expect(entries[1]?.path).toBe(normalize("/path/to/my\nother\nworktree"));
		});

		describe("newline-terminated output (git before 2.36, no -z)", () => {
			it("parses blocks separated by a blank line", () => {
				const output =
					[
						[
							"worktree /path/to/my repo",
							"HEAD abc1234abc1234abc1234abc1234abc1234abc123",
							"branch refs/heads/main",
						].join("\n"),
						[
							"worktree /path/to/linked",
							"HEAD def5678def5678def5678def5678def5678def567",
							"detached",
							"locked reason why it is locked",
						].join("\n"),
					].join("\n\n") + "\n\n";

				const entries = parseWorktreePorcelainOutput(output, { nulTerminated: false });
				expect(entries).toEqual([
					{
						path: normalize("/path/to/my repo"),
						head: "abc1234abc1234abc1234abc1234abc1234abc123",
						branch: "refs/heads/main",
						isDetached: false,
						type: "main",
						isLocked: false,
						isPrunable: false,
					},
					{
						path: normalize("/path/to/linked"),
						head: "def5678def5678def5678def5678def5678def567",
						branch: null,
						isDetached: true,
						type: "linked",
						isLocked: true,
						isPrunable: false,
					},
				]);
			});

			it("returns empty array for empty output", () => {
				expect(parseWorktreePorcelainOutput("\n", { nulTerminated: false })).toEqual([]);
			});
		});
	});

	describe("listWorktrees", () => {
		const mainBlock = ["worktree /repo", "HEAD abc1234abc1234abc1234abc1234abc1234abc123"];

		function recordingExec(stdout: string) {
			const calls: string[][] = [];
			const exec: WorktreeExec = async (args) => {
				calls.push(args);
				return {
					stdout,
					stderr: "",
					exitCode: 0,
					gitError: null,
					gitErrorDescription: null,
					path: "/repo",
				};
			};
			return { calls, exec };
		}

		it("asks for NUL-terminated output by default", async () => {
			const { calls, exec } = recordingExec(mainBlock.join("\0") + "\0");

			const entries = await listWorktrees(exec);

			expect(calls).toEqual([["worktree", "list", "--porcelain", "-z"]]);
			expect(entries[0]?.path).toBe(normalize("/repo"));
		});

		it("omits -z and parses newline output when NUL termination is off", async () => {
			const { calls, exec } = recordingExec(mainBlock.join("\n") + "\n\n");

			const entries = await listWorktrees(exec, { nulTerminated: false });

			expect(calls).toEqual([["worktree", "list", "--porcelain"]]);
			expect(entries[0]?.path).toBe(normalize("/repo"));
		});
	});

	describe("client worktree methods", () => {
		it("lists only the main worktree when none are linked", async () => {
			const repoPath = await initialize("worktree-list-main", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });

			const worktrees = await createGitClient({ path: repoPath, logger: noopLogger }).worktrees();

			expect(worktrees).toHaveLength(1);
			expect(worktrees[0]).toMatchObject({ type: "main", branch: "refs/heads/main" });
		});

		it("lists linked worktrees with their branches", async () => {
			const repoPath = await initialize("worktree-list-linked", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			const client = createGitClient({ path: repoPath, logger: noopLogger });
			await client.createBranch("feature-a");
			await client.addWorktree(join(repoPath, "wt-a"), { createBranch: "wt-branch" });

			const worktrees = await client.worktrees();
			// macOS temp dirs live behind a symlink git resolves away.
			const resolvedRepoPath = await realpath(repoPath);

			expect(worktrees.map((worktree) => worktree.type)).toEqual(["main", "linked"]);
			expect(worktrees[1]).toMatchObject({
				path: join(resolvedRepoPath, "wt-a"),
				branch: "refs/heads/wt-branch",
			});
		});

		it("adds a worktree with a new branch at an explicit commitish", async () => {
			const repoPath = await initialize("worktree-add", "main");
			await makeCommit(repoPath, { entries: [{ path: "first.md", contents: "first" }] });
			await makeCommit(repoPath, { entries: [{ path: "second.md", contents: "second" }] });
			const client = createGitClient({ path: repoPath, logger: noopLogger });

			await client.addWorktree(join(repoPath, "kilo-wt"), {
				createBranch: "kilo/test",
				commitish: "HEAD~1",
			});

			const branches = await client.branches();
			expect(branches?.find((branch) => branch.name === "kilo/test")).toBeDefined();
			const startPoint = await gitExec(["rev-parse", "HEAD~1"], repoPath);
			expect(branches?.find((branch) => branch.name === "kilo/test")).toMatchObject({
				tip: { sha: startPoint.stdout.trim() },
			});
			const worktrees = await client.worktrees();
			expect(worktrees[1]).toMatchObject({ branch: "refs/heads/kilo/test" });
		});

		it("removes a worktree", async () => {
			const repoPath = await initialize("worktree-remove", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			const client = createGitClient({ path: repoPath, logger: noopLogger });
			const worktreePath = join(repoPath, "wt-a");
			await client.addWorktree(worktreePath, { createBranch: "wt-branch" });

			await client.removeWorktree(worktreePath);

			const worktrees = await client.worktrees();
			expect(worktrees).toHaveLength(1);
			expect(worktrees[0]?.type).toBe("main");
		});

		it("force removes a dirty worktree", async () => {
			const repoPath = await initialize("worktree-remove-force", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			const client = createGitClient({ path: repoPath, logger: noopLogger });
			const worktreePath = join(repoPath, "wt-a");
			await client.addWorktree(worktreePath, { createBranch: "wt-branch" });
			await writeFile(join(worktreePath, "README.md"), "dirty");

			await expect(client.removeWorktree(worktreePath)).rejects.toThrow();
			await client.removeWorktree(worktreePath, { force: true });

			const worktrees = await client.worktrees();
			expect(worktrees).toHaveLength(1);
		});

		it("honors a cwd override distinct from the client path", async () => {
			const repoPath = await initialize("worktree-cwd", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			const clientFromElsewhere = createGitClient({
				path: await createTestDir("worktree-cwd-outside"),
				logger: noopLogger,
			});

			const worktrees = await clientFromElsewhere.worktrees({ cwd: repoPath });

			expect(worktrees).toHaveLength(1);
			expect(worktrees[0]).toMatchObject({ type: "main" });
		});

		it("pruneWorktrees removes stale registrations", async () => {
			const repoPath = await initialize("worktree-prune", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			const client = createGitClient({ path: repoPath, logger: noopLogger });
			const worktreePath = join(repoPath, "wt-prune");
			await client.addWorktree(worktreePath, { createBranch: "prune-branch" });

			// Remove the directory without going through `git worktree remove`
			// so the registration stays behind as stale.
			await rm(worktreePath, { recursive: true, force: true });

			// The stale registration is still listed until prune runs.
			expect(await client.worktrees()).toHaveLength(2);

			await expect(client.pruneWorktrees({ cwd: repoPath })).resolves.toBeUndefined();

			// The listing should now show only the main worktree.
			expect(await client.worktrees()).toHaveLength(1);
		});
	});

	describe("client branch methods", () => {
		it("deletes a branch", async () => {
			const repoPath = await initialize("branch-delete", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			const client = createGitClient({ path: repoPath, logger: noopLogger });
			await client.createBranch("feature");

			await client.deleteBranch("feature");

			const branches = await client.branches();
			expect(branches?.find((branch) => branch.name === "feature")).toBeUndefined();
		});

		it("renames a branch", async () => {
			const repoPath = await initialize("branch-rename", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			const client = createGitClient({ path: repoPath, logger: noopLogger });
			await client.createBranch("feature");

			await client.renameBranch("feature", "renamed");

			const branches = await client.branches();
			expect(branches?.find((branch) => branch.name === "feature")).toBeUndefined();
			expect(branches?.find((branch) => branch.name === "renamed")).toBeDefined();
		});
	});

	describe("defaultBranch", () => {
		async function initializeWithOrigin(name: string): Promise<string> {
			const repoPath = await initialize(name, "main");
			const remote = await createTestDir(`${name}-remote`);
			// Pin the remote HEAD: `remote set-head -a` must not depend on the ambient
			// init.defaultBranch (turbo strict env mode strips CI's GIT_CONFIG_* pinning).
			await gitExec(["init", "--bare", "-b", "main"], remote);
			await gitExec(["remote", "add", "origin", remote], repoPath);
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			return repoPath;
		}

		it("resolves null when origin/HEAD is unset", async () => {
			const repoPath = await initializeWithOrigin("default-branch-unset");
			const client = createGitClient({ path: repoPath, logger: noopLogger });

			expect(await client.defaultBranch()).toBeNull();
		});

		it("resolves the origin/HEAD symref short name", async () => {
			const repoPath = await initializeWithOrigin("default-branch-set");
			await gitExec(["push", "origin", "main"], repoPath);
			await gitExec(["remote", "set-head", "origin", "-a"], repoPath);
			const client = createGitClient({ path: repoPath, logger: noopLogger });

			expect(await client.defaultBranch()).toBe("main");
		});

		it("resolves null outside a repository", async () => {
			const emptyDir = await createTestDir("default-branch-norepo");

			await expect(
				createGitClient({ path: emptyDir, logger: noopLogger }).defaultBranch(),
			).resolves.toBeNull();
		});
	});
});
