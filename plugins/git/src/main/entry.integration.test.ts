import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WorktreeBranchRenamed } from "../contracts";
import { APP_ORIGIN, bootGit as boot, stopBootedKernels } from "./repository/test-boot";

const directories: string[] = [];

afterEach(async () => {
	await stopBootedKernels();
	// Windows: AV scanners and just-exited git processes can hold handles
	// briefly — retry like git-client's test util does.
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});

function createTempDir(): string {
	// `.native` expands Windows 8.3 short names (RUNNER~1 in CI's TEMP) to the
	// long form git reports, so expectations built from it match git's paths.
	const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "git-plugin-")));
	directories.push(directory);
	return directory;
}

function execGit(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "pipe" });
}

function execGitOutput(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}

/** Git porcelain output always uses forward slashes, even on Windows. */
function toGitPath(filePath: string): string {
	return filePath.replaceAll("\\", "/");
}

/**
 * Create a temp git repository on branch `main` with one empty commit.
 *
 * git-client does not isolate the global git config, so identity is set
 * repo-locally and commits run with `commit.gpgsign=false` to stay
 * deterministic on any developer machine.
 */
function initRepo(): string {
	const repoDir = createTempDir();
	execGit(repoDir, ["init", "-b", "main"]);
	execGit(repoDir, ["config", "user.email", "git-plugin@example.com"]);
	execGit(repoDir, ["config", "user.name", "Git Plugin Test"]);
	commit(repoDir, "initial");
	return repoDir;
}

function commit(repoDir: string, message: string): void {
	execGit(repoDir, ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message]);
}

/** Clone of a repo whose origin has `main` plus an untracked `feature`. */
function cloneWithUntrackedRemoteFeature(): string {
	const sourceDir = initRepo();
	execGit(sourceDir, ["checkout", "-b", "feature"]);
	commit(sourceDir, "feature");
	execGit(sourceDir, ["checkout", "main"]);

	const remoteDir = createTempDir();
	execGit(remoteDir, ["init", "--bare", "-b", "main"]);
	execGit(sourceDir, ["remote", "add", "origin", remoteDir]);
	execGit(sourceDir, ["push", "-u", "origin", "main"]);
	execGit(sourceDir, ["push", "origin", "feature"]);

	const cloneDir = createTempDir();
	execGit(cloneDir, ["clone", remoteDir, "."]);
	return cloneDir;
}

/** Two branches diverge on README.md, then the working tree is dirtied so a switch would clobber it. */
function setupDirtyTreeConflict(repoDir: string): void {
	fs.writeFileSync(path.join(repoDir, "README.md"), "v1\n");
	execGit(repoDir, ["add", "README.md"]);
	commit(repoDir, "main change");
	execGit(repoDir, ["checkout", "-b", "feature"]);
	fs.writeFileSync(path.join(repoDir, "README.md"), "v2\n");
	execGit(repoDir, ["add", "README.md"]);
	commit(repoDir, "feature change");
	execGit(repoDir, ["checkout", "main"]);
	fs.writeFileSync(path.join(repoDir, "README.md"), "dirty\n");
}

/**
 * Runs `run` with `GIT_CONFIG_GLOBAL` pointed at a stub file holding the
 * given content — every git spawned while it is set reads it, including the
 * real git-client inside mainRegister (whose children inherit this env at
 * spawn time), so global-config probes (`init.defaultBranch`) are
 * deterministic and never touch the developer's real `~/.gitconfig`. The
 * stub also overrides any ambient `GIT_CONFIG_GLOBAL` a CI job sets, which
 * a `HOME` stub could not.
 */
async function withGitConfig(gitconfig: string, run: () => Promise<void>): Promise<void> {
	const stubPath = path.join(createTempDir(), ".gitconfig");
	fs.writeFileSync(stubPath, gitconfig);
	const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
	process.env.GIT_CONFIG_GLOBAL = stubPath;
	try {
		await run();
	} finally {
		if (previousGlobalConfig === undefined) {
			delete process.env.GIT_CONFIG_GLOBAL;
		} else {
			process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
		}
	}
}

/**
 * Clone of a repo whose origin has `main` (HEAD), `feature`, and whose
 * local checkout history is main → topic-a → main → topic-b → main.
 */
function cloneWithCheckoutHistory(): string {
	const sourceDir = initRepo();
	execGit(sourceDir, ["checkout", "-b", "feature"]);
	commit(sourceDir, "feature");
	execGit(sourceDir, ["checkout", "main"]);

	const remoteDir = createTempDir();
	execGit(remoteDir, ["init", "--bare", "-b", "main"]);
	execGit(sourceDir, ["remote", "add", "origin", remoteDir]);
	execGit(sourceDir, ["push", "-u", "origin", "main"]);
	execGit(sourceDir, ["push", "origin", "feature"]);

	const cloneDir = createTempDir();
	execGit(cloneDir, ["clone", remoteDir, "."]);
	execGit(cloneDir, ["checkout", "-b", "topic-a"]);
	execGit(cloneDir, ["checkout", "main"]);
	execGit(cloneDir, ["checkout", "-b", "topic-b"]);
	execGit(cloneDir, ["checkout", "main"]);
	return cloneDir;
}

describe("kilo.git repository", () => {
	it("registers the status channel and reports a clean repository", async () => {
		const repoDir = initRepo();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(repository.methods.status({ directory: repoDir })).resolves.toMatchObject({
			exists: true,
			currentBranch: "main",
			doConflictedFilesExist: false,
			workingDirectory: { files: [] },
		});
	});

	it("reports an untracked file as a working-directory change", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "notes.txt"), "hello");
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(repository.methods.status({ directory: repoDir })).resolves.toMatchObject({
			exists: true,
			workingDirectory: {
				files: [{ path: "notes.txt", status: { kind: "Untracked" } }],
			},
		});
	});

	it("resolves null for a directory that is not a git repository", async () => {
		const plainDir = createTempDir();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(plainDir);

		await expect(repository.methods.status({ directory: plainDir })).resolves.toBe(null);
	});

	it("rejects an empty working directory at the domain boundary", async () => {
		const { repository } = await boot();

		await expect(repository.methods.status({ directory: "" })).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
	});

	it("provides kilo.work-sessions/vcs to other plugins", async () => {
		const repoDir = initRepo();
		const { vcs, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(vcs.status(repoDir)).resolves.toMatchObject({
			exists: true,
			currentBranch: "main",
			workingDirectory: { files: [] },
		});
		await expect(vcs.available()).resolves.toBe(true);
		await expect(vcs.defaultBranch(repoDir)).resolves.toBe("main");
		await expect(vcs.branches(repoDir)).resolves.toMatchObject({ currentBranch: "main" });
		expect(vcs.isManagedBranch("kilo/brave-otter")).toBe(true);
		expect(vcs.isManagedBranch("main")).toBe(false);
	});

	it("reports git as available", async () => {
		const { repository } = await boot();

		await expect(repository.methods.available(undefined)).resolves.toBe(true);
	});

	it("invokes getDiffContents and returns both sides for a modified file", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "README.md"), "committed\n");
		execGit(repoDir, ["add", "README.md"]);
		commit(repoDir, "add readme");
		fs.writeFileSync(path.join(repoDir, "README.md"), "on disk\n");
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(
			repository.methods.getDiffContents({ directory: repoDir, path: "README.md" }),
		).resolves.toEqual({ oldContents: "committed\n", newContents: "on disk\n" });
	});

	it("resolves null newContents for a deleted file and null oldContents for an untracked file", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "deleted.txt"), "committed\n");
		fs.writeFileSync(path.join(repoDir, "untracked.txt"), "never committed\n");
		execGit(repoDir, ["add", "deleted.txt"]);
		commit(repoDir, "add deleted");
		fs.rmSync(path.join(repoDir, "deleted.txt"));
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(
			repository.methods.getDiffContents({ directory: repoDir, path: "deleted.txt" }),
		).resolves.toEqual({ oldContents: "committed\n", newContents: null });
		await expect(
			repository.methods.getDiffContents({ directory: repoDir, path: "untracked.txt" }),
		).resolves.toEqual({ oldContents: null, newContents: "never committed\n" });
	});

	it("rejects an empty path with VALIDATION at the domain boundary", async () => {
		const { repository } = await boot();

		await expect(
			repository.methods.getDiffContents({ directory: "/repos/project", path: "" }),
		).rejects.toMatchObject({ name: "KernelError", code: "VALIDATION" });
	});

	it("fails closed when kilo.work-sessions is absent", async () => {
		const repoDir = initRepo();
		const { repository } = await boot({ workSessions: false });

		await expect(repository.methods.status({ directory: repoDir })).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
			message: expect.stringContaining("Workspaces are unavailable"),
		});
	});

	it("accepts managed worktrees inside a workspace folder", async () => {
		const repoDir = initRepo();
		const { repository, vcs, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);
		const worktree = await vcs.createCopy({ directory: repoDir });

		await expect(
			repository.methods.status({ directory: worktree.directory }),
		).resolves.toMatchObject({ currentBranch: worktree.branch });

		await vcs.removeCopy({ directory: worktree.directory });
	});

	it("rejects status for a directory outside every workspace folder", async () => {
		const repoDir = initRepo();
		const otherDir = createTempDir();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(otherDir);

		await expect(repository.methods.status({ directory: repoDir })).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
	});

	it("handles the kilo-git protocol", async () => {
		const { protocol } = await boot();

		const response = await protocol.handler(new Request("kilo-git://diff/patch"));
		// cwd is validated before the service runs, with no filesystem needed.
		expect(response.status).toBe(400);
	});

	it("stops handling the kilo-git protocol on deactivate", async () => {
		const { kernel, protocol } = await boot();

		await kernel.stop();

		await expect(protocol.handler(new Request("kilo-git://diff/patch"))).rejects.toThrow(
			"kilo-git is not handled.",
		);
	});

	it("grants CORS to the app's renderer origins only", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "README.md"), "hello\n");
		const { protocol, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);
		const url = `kilo-git://diff/patch?cwd=${encodeURIComponent(repoDir)}`;

		const app = await protocol.handler(new Request(url, { headers: { Origin: APP_ORIGIN } }));
		expect(app.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);
		expect(await app.text()).toContain("+hello");

		const foreign = await protocol.handler(
			new Request(url, { headers: { Origin: "https://evil.example" } }),
		);
		expect(foreign.headers.get("Access-Control-Allow-Origin")).toBeNull();
		await foreign.body?.cancel();
	});

	it("streams the working-tree patch through the registered handler", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "README.md"), "hello\n");
		const { protocol, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		const response = await protocol.handler(
			new Request(`kilo-git://diff/patch?cwd=${encodeURIComponent(repoDir)}`),
		);
		expect(response.status).toBe(200);
		const patch = await response.text();
		expect(patch).toContain("diff --git a/README.md b/README.md");
		expect(patch).toContain("+hello");
		expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
	});

	it("caps an oversized patch at 413 unless unlimited=1 is requested", async () => {
		const repoDir = initRepo();
		const line = `${"x".repeat(80)}\n`;
		const elevenMiB = 11 * 1024 * 1024;
		fs.writeFileSync(
			path.join(repoDir, "huge.txt"),
			line.repeat(Math.ceil(elevenMiB / line.length)),
		);
		const { protocol, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);
		const patchUrl = `kilo-git://diff/patch?cwd=${encodeURIComponent(repoDir)}`;

		const capped = await protocol.handler(new Request(patchUrl));
		expect(capped.status).toBe(413);
		expect(await capped.text()).toContain("too large");

		const unlimited = await protocol.handler(new Request(`${patchUrl}&unlimited=1`));
		expect(unlimited.status).toBe(200);
		const patch = await unlimited.text();
		expect(patch).toContain("diff --git a/huge.txt b/huge.txt");
		expect(Buffer.byteLength(patch)).toBeGreaterThan(10 * 1024 * 1024);
	});

	it("serves an empty 200 body for a clean working tree", async () => {
		const repoDir = initRepo();
		const { protocol, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		const response = await protocol.handler(
			new Request(`kilo-git://diff/patch?cwd=${encodeURIComponent(repoDir)}`),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	it("responds 404 through the handler for a non-repository directory", async () => {
		const plainDir = createTempDir();
		const { protocol, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(plainDir);

		const response = await protocol.handler(
			new Request(`kilo-git://diff/patch?cwd=${encodeURIComponent(plainDir)}`),
		);
		expect(response.status).toBe(404);
		expect(await response.text()).toContain("Not a git repository");
	});

	it("responds 403 through the handler for a directory outside every workspace folder", async () => {
		const repoDir = initRepo();
		const otherDir = createTempDir();
		const { protocol, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(otherDir);

		const response = await protocol.handler(
			new Request(`kilo-git://diff/patch?cwd=${encodeURIComponent(repoDir)}`),
		);
		expect(response.status).toBe(403);
		expect(await response.text()).toContain("not inside a workspace folder");
	});
});

describe("kilo.git repository branches", () => {
	it("reports the current branch alongside the branch list", async () => {
		const repoDir = initRepo();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await withGitConfig("", async () => {
			const result = await repository.methods.branches({ directory: repoDir });

			expect(result).toStrictEqual({
				currentBranch: "main",
				branches: [
					{
						name: "main",
						upstream: null,
						tip: { sha: expect.any(String) },
						ref: "refs/heads/main",
						kind: "local",
					},
				],
				// The literal `main` fallback: no remote HEAD, no configured default.
				defaultBranch: "main",
				recentBranches: [],
			});
		});
	});

	it("detects the configured default branch from global config", async () => {
		const repoDir = createTempDir();
		execGit(repoDir, ["init", "-b", "trunk"]);
		execGit(repoDir, ["config", "user.email", "git-plugin@example.com"]);
		execGit(repoDir, ["config", "user.name", "Git Plugin Test"]);
		commit(repoDir, "initial");
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await withGitConfig("[init]\n\tdefaultBranch = trunk\n", async () => {
			const result = await repository.methods.branches({ directory: repoDir });
			expect(result).toMatchObject({ defaultBranch: "trunk" });
		});
	});

	it("detects the remote HEAD as the default and resolves recency from real checkouts", async () => {
		const cloneDir = cloneWithCheckoutHistory();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(cloneDir);

		await withGitConfig("", async () => {
			const result = await repository.methods.branches({ directory: cloneDir });

			expect(result).toMatchObject({
				currentBranch: "main",
				defaultBranch: "main",
				// Reflog order after main → topic-a → main → topic-b → main,
				// with the default branch excluded.
				recentBranches: ["topic-b", "topic-a"],
				branches: expect.arrayContaining([
					expect.objectContaining({ name: "main", kind: "local", upstream: "origin/main" }),
					expect.objectContaining({ name: "origin/feature", kind: "remote" }),
					expect.objectContaining({ name: "topic-a", kind: "local" }),
					expect.objectContaining({ name: "topic-b", kind: "local" }),
				]),
			});
		});
	});

	it("resolves null for a directory that is not a git repository", async () => {
		const plainDir = createTempDir();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(plainDir);

		await expect(repository.methods.branches({ directory: plainDir })).resolves.toBe(null);
	});

	it("lists remote-tracking branches that no local branch tracks", async () => {
		const cloneDir = cloneWithUntrackedRemoteFeature();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(cloneDir);

		const result = await repository.methods.branches({ directory: cloneDir });

		expect(result).toMatchObject({
			currentBranch: "main",
			branches: expect.arrayContaining([
				expect.objectContaining({ name: "main", kind: "local" }),
				expect.objectContaining({ name: "origin/feature", kind: "remote" }),
			]),
		});
		expect(result).toMatchObject({
			branches: expect.not.arrayContaining([expect.objectContaining({ name: "origin/main" })]),
		});
	});
});

describe("kilo.git repository repositoryType", () => {
	it("registers the repositoryType channel and classifies a regular repository", async () => {
		const repoDir = initRepo();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(repository.methods.repositoryType({ directory: repoDir })).resolves.toEqual({
			kind: "regular",
			topLevelWorkingDirectory: repoDir,
			gitDir: path.join(repoDir, ".git"),
		});
	});

	it("resolves missing for a directory that is not a git repository", async () => {
		const plainDir = createTempDir();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(plainDir);

		await expect(repository.methods.repositoryType({ directory: plainDir })).resolves.toEqual({
			kind: "missing",
		});
	});
});

describe("kilo.git repository defaultBranch", () => {
	it("resolves the default branch for a regular repository", async () => {
		const repoDir = initRepo();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(repository.methods.defaultBranch({ directory: repoDir })).resolves.toBe("main");
	});

	it("resolves null outside a repository", async () => {
		const plainDir = createTempDir();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(plainDir);

		await expect(repository.methods.defaultBranch({ directory: plainDir })).resolves.toBeNull();
	});

	it("rejects a directory outside every workspace folder", async () => {
		const repoDir = initRepo();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(
			repository.methods.defaultBranch({ directory: createTempDir() }),
		).rejects.toMatchObject({ name: "KernelError", code: "VALIDATION" });
	});
});

describe("kilo.git repository actions", () => {
	it("stages, commits, pushes, fetches and pulls through the domain", async () => {
		const remoteDir = createTempDir();
		execGit(remoteDir, ["init", "--bare", "-b", "main"]);
		const repoDir = initRepo();
		execGit(repoDir, ["config", "commit.gpgsign", "false"]);
		execGit(repoDir, ["remote", "add", "origin", remoteDir]);
		execGit(repoDir, ["push", "-u", "origin", "main"]);
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);
		fs.writeFileSync(path.join(repoDir, "one.txt"), "a\nb\n");

		await expect(repository.methods.workingTreeStats({ directory: repoDir })).resolves.toEqual({
			additions: 2,
			deletions: 0,
		});
		const staged = await repository.methods.stageChanges({ directory: repoDir });
		expect(staged.diffPatch).toContain("+a");
		await repository.methods.commit({ directory: repoDir, message: "Add one" });
		await repository.methods.push({ directory: repoDir });
		expect(execGitOutput(remoteDir, ["log", "-1", "--format=%s", "main"])).toBe("Add one");

		await repository.methods.fetch({ directory: repoDir });
		await repository.methods.pull({ directory: repoDir });
		await expect(repository.methods.originUrl({ directory: repoDir })).resolves.toBe(remoteDir);
		await expect(
			repository.methods.pullRequestContext({ directory: repoDir, baseBranch: "main" }),
		).resolves.toMatchObject({ pullRequestTemplate: null });
	});

	it("answers pull request lookups for a non-GitHub origin without the GitHub CLI", async () => {
		const repoDir = initRepo();
		execGit(repoDir, ["remote", "add", "origin", "https://gitlab.example/team/app.git"]);
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(repository.methods.pullRequest({ directory: repoDir })).resolves.toBeNull();
		await expect(
			repository.methods.pullRequestSnapshot({ directory: repoDir }),
		).resolves.toMatchObject({ pullRequest: null, githubStatus: "unsupported" });
		await expect(
			repository.methods.pullRequestSnapshots({ directories: [repoDir] }),
		).resolves.toEqual([
			{ directory: repoDir, snapshot: expect.objectContaining({ githubStatus: "unsupported" }) },
		]);
	});
});

describe("kilo.git vcs copies", () => {
	function localBranches(repoDir: string): string[] {
		return execGitOutput(repoDir, [
			"for-each-ref",
			"--format=%(refname:short)",
			"refs/heads",
		]).split("\n");
	}

	it("creates, lists, resolves and removes a managed worktree", async () => {
		const repoDir = initRepo();
		const { vcs, repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		const worktree = await vcs.createCopy({ directory: repoDir });
		expect(worktree.directory).toMatch(/[\\/]\.kilo[\\/]worktrees[\\/]kilo-/);
		expect(worktree.branch).toMatch(/^kilo\//);
		expect(worktree.baseRef).toBe("main");

		const listing = execGitOutput(repoDir, ["worktree", "list", "--porcelain"]);
		expect(listing).toContain(toGitPath(worktree.directory));
		expect(localBranches(repoDir)).toContain(worktree.branch);
		await expect(vcs.copies(repoDir)).resolves.toEqual([
			{ path: repoDir, name: path.basename(repoDir), branch: "main", isMain: true },
			{
				path: worktree.directory,
				name: path.basename(worktree.directory),
				branch: worktree.branch,
				isMain: false,
			},
		]);
		await expect(repository.methods.worktrees({ directory: repoDir })).resolves.toHaveLength(2);
		await expect(
			vcs.resolveCopy({ directory: repoDir, copy: worktree.directory }),
		).resolves.toEqual({ directory: worktree.directory, branch: worktree.branch });
		await expect(vcs.hasCopyWork({ directory: worktree.directory })).resolves.toBe(false);
		fs.writeFileSync(path.join(worktree.directory, "notes.txt"), "work");
		await expect(vcs.hasCopyWork({ directory: worktree.directory })).resolves.toBe(true);

		await vcs.removeCopy({ directory: worktree.directory });
		expect(fs.existsSync(worktree.directory)).toBe(false);
		expect(localBranches(repoDir)).not.toContain(worktree.branch);
		await expect(
			vcs.resolveCopy({ directory: repoDir, copy: worktree.directory }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("serves worktrees of a folder registered through another spelling of its path", async () => {
		// A linked folder stands in for a Windows 8.3 short name or a macOS
		// /var → /private/var alias: git reports the real path, the
		// workspace holds the alias.
		const repoDir = initRepo();
		const alias = path.join(createTempDir(), "alias");
		fs.symlinkSync(repoDir, alias, "junction");
		const { vcs, repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(alias);

		const worktree = await vcs.createCopy({ directory: alias });
		const listed = await vcs.copies(alias);
		expect(listed?.map((entry) => fs.realpathSync.native(entry.path))).toEqual([
			repoDir,
			fs.realpathSync.native(worktree.directory),
		]);
		await expect(
			repository.methods.status({ directory: worktree.directory }),
		).resolves.toMatchObject({ currentBranch: worktree.branch });
		const aliased = path.join(alias, ".kilo", "worktrees", path.basename(worktree.directory));
		await expect(vcs.resolveCopy({ directory: alias, copy: aliased })).resolves.toEqual({
			directory: worktree.directory,
			branch: worktree.branch,
		});

		await vcs.removeCopy({ directory: worktree.directory });
	});

	it("names the branch when asked and keeps it on removal when told to", async () => {
		const repoDir = initRepo();
		const { vcs, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		const first = await vcs.createCopy({ directory: repoDir, branch: "Fix the Login Bug!" });
		const second = await vcs.createCopy({ directory: repoDir, branch: "Fix the Login Bug!" });
		expect(first.branch).toBe("kilo/fix-the-login-bug");
		expect(second.branch).toBe("kilo/fix-the-login-bug-2");

		await vcs.removeCopy({ directory: first.directory, deleteBranch: false });
		await vcs.removeCopy({ directory: second.directory });
		expect(localBranches(repoDir)).toContain(first.branch);
		expect(localBranches(repoDir)).not.toContain(second.branch);
	});

	it("appends .kilo/worktrees/ to the repository's exclude file", async () => {
		const repoDir = initRepo();
		const { vcs, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		const worktree = await vcs.createCopy({ directory: repoDir });
		const exclude = fs.readFileSync(path.join(repoDir, ".git", "info", "exclude"), "utf-8");
		expect(exclude).toContain(".kilo/worktrees/");

		await vcs.removeCopy({ directory: worktree.directory });
	});

	it("falls back to the local base with a warning when fetching the remote fails", async () => {
		const repoDir = initRepo();
		execGit(repoDir, ["remote", "add", "origin", path.join(createTempDir(), "no-such-remote")]);
		const { vcs, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		const worktree = await vcs.createCopy({ directory: repoDir });

		expect(worktree.warning).toBe(
			"Could not fetch latest main from origin; branched from local state.",
		);
		const listing = execGitOutput(repoDir, ["worktree", "list", "--porcelain"]);
		expect(listing).toContain(toGitPath(worktree.directory));

		await vcs.removeCopy({ directory: worktree.directory });
	});

	it("bases remote-tracking start points on a commit so semantic rename stays eligible", async () => {
		const repoDir = initRepo();
		// A bare clone acts as a real (local) remote the fetch can succeed on.
		const remoteDir = createTempDir();
		execGit(os.tmpdir(), ["clone", "--bare", repoDir, remoteDir]);
		execGit(repoDir, ["remote", "add", "origin", remoteDir]);
		execGit(repoDir, ["fetch", "origin"]);
		const { vcs, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		const worktree = await vcs.createCopy({ directory: repoDir });

		expect(worktree.warning).toBeUndefined();
		// Without the `^{commit}` dereference, `worktree add -b <branch> origin/main`
		// sets upstream tracking on the new branch, and the no-upstream guard
		// would decline every semantic rename for that session.
		const upstream = execGitOutput(repoDir, [
			"for-each-ref",
			"--format=%(upstream:short)",
			`refs/heads/${worktree.branch}`,
		]);
		expect(upstream).toBe("");

		const rename = await vcs.renameCopyBranch({
			directory: worktree.directory,
			currentBranch: worktree.branch,
			requestedBranch: "Fix the Login Bug!",
		});
		expect(rename).toEqual({ branch: "kilo/fix-the-login-bug" });

		await vcs.removeCopy({ directory: worktree.directory });
	});

	it("announces worktree-branch-renamed and toasts when a rename succeeds", async () => {
		const repoDir = initRepo();
		const { vcs, repository, toasts, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);
		const worktree = await vcs.createCopy({ directory: repoDir });
		const events: WorktreeBranchRenamed[] = [];
		repository.on("worktree-branch-renamed", (payload) => events.push(payload));

		const renamed = await vcs.renameCopyBranch({
			directory: worktree.directory,
			currentBranch: worktree.branch,
			requestedBranch: "Fix the Login Bug!",
		});

		expect(renamed).toEqual({ branch: "kilo/fix-the-login-bug" });
		expect(events).toEqual([{ directory: worktree.directory, branch: "kilo/fix-the-login-bug" }]);
		await expect
			.poll(() => toasts)
			.toEqual([{ level: "success", title: "Branch renamed to kilo/fix-the-login-bug" }]);
		await vcs.removeCopy({ directory: worktree.directory });
	});

	it("renames without kilo.shell, announcing the rename only", async () => {
		const repoDir = initRepo();
		const { vcs, repository, addWorkspaceFolder } = await boot({ shell: false });
		addWorkspaceFolder(repoDir);
		const worktree = await vcs.createCopy({ directory: repoDir });
		const events: WorktreeBranchRenamed[] = [];
		repository.on("worktree-branch-renamed", (payload) => events.push(payload));

		await expect(
			vcs.renameCopyBranch({
				directory: worktree.directory,
				currentBranch: worktree.branch,
				requestedBranch: "Tidy up",
			}),
		).resolves.toEqual({ branch: "kilo/tidy-up" });
		expect(events).toEqual([{ directory: worktree.directory, branch: "kilo/tidy-up" }]);
		await vcs.removeCopy({ directory: worktree.directory });
	});

	it("announces nothing when a rename is declined", async () => {
		const repoDir = initRepo();
		const { vcs, repository, toasts } = await boot();
		const events: WorktreeBranchRenamed[] = [];
		repository.on("worktree-branch-renamed", (payload) => events.push(payload));

		// The main checkout is not a managed worktree.
		const result = await vcs.renameCopyBranch({
			directory: repoDir,
			currentBranch: "main",
			requestedBranch: "some-name",
		});

		expect(result).toBeNull();
		expect(events).toHaveLength(0);
		expect(toasts).toHaveLength(0);
	});

	it("links a managed worktree to an Agent Manager session once", async () => {
		const repoDir = initRepo();
		const { vcs, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);
		const worktree = await vcs.createCopy({ directory: repoDir });

		await expect(
			vcs.linkAgentManagerSession({ directory: worktree.directory, chatId: "ses_1" }),
		).resolves.toBe(true);
		await expect(
			vcs.linkAgentManagerSession({ directory: worktree.directory, chatId: "ses_2" }),
		).resolves.toBe(false);
		await expect(
			vcs.linkAgentManagerSession({ directory: repoDir, chatId: "ses_3" }),
		).resolves.toBe(false);

		await vcs.removeCopy({ directory: worktree.directory });
	});
});

describe("kilo.git repository checkout", () => {
	it("checks out a remote-tracking branch as a local tracking branch", async () => {
		const cloneDir = cloneWithUntrackedRemoteFeature();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(cloneDir);

		await repository.methods.checkout({
			directory: cloneDir,
			branch: "origin/feature",
			kind: "remote",
		});

		const branches = await repository.methods.branches({ directory: cloneDir });
		expect(branches).toMatchObject({
			currentBranch: "feature",
			branches: expect.arrayContaining([
				expect.objectContaining({
					name: "feature",
					kind: "local",
					upstream: "origin/feature",
				}),
			]),
		});
		expect(branches).toMatchObject({
			branches: expect.not.arrayContaining([expect.objectContaining({ name: "origin/feature" })]),
		});
	});

	it("creates and switches to a new branch, then switches back", async () => {
		const repoDir = initRepo();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await repository.methods.checkout({ directory: repoDir, branch: "feature", create: true });

		let branches = await repository.methods.branches({ directory: repoDir });
		expect(branches).toMatchObject({ currentBranch: "feature" });
		expect(branches).toMatchObject({
			branches: expect.arrayContaining([expect.objectContaining({ name: "feature" })]),
		});

		await repository.methods.checkout({ directory: repoDir, branch: "main" });
		branches = await repository.methods.branches({ directory: repoDir });
		expect(branches).toMatchObject({ currentBranch: "main" });
	});

	it("rejects when checking out a branch that does not exist", async () => {
		const repoDir = initRepo();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(
			repository.methods.checkout({ directory: repoDir, branch: "missing" }),
		).rejects.toThrow();
	});

	it("creates the branch off the named start point's tip", async () => {
		const repoDir = initRepo();
		execGit(repoDir, ["checkout", "-b", "feature"]);
		commit(repoDir, "feature change");
		const mainTip = execGitOutput(repoDir, ["rev-parse", "main"]);
		const featureTip = execGitOutput(repoDir, ["rev-parse", "feature"]);
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await repository.methods.checkout({
			directory: repoDir,
			branch: "topic",
			create: true,
			startPoint: "main",
		});

		const branches = await repository.methods.branches({ directory: repoDir });
		expect(branches).toMatchObject({
			branches: expect.arrayContaining([
				expect.objectContaining({ name: "topic", tip: { sha: mainTip } }),
			]),
		});
		// HEAD (feature) has its own commit, so the tip equality above proves
		// the start point — not the current HEAD — anchored the branch.
		expect(mainTip).not.toBe(featureTip);
	});

	it("rejects with a BUSINESS KernelError when creating an existing branch name", async () => {
		const repoDir = initRepo();
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(
			repository.methods.checkout({ directory: repoDir, branch: "main", create: true }),
		).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
			message: "A branch with that name already exists.",
		});
	});

	it("rejects with a BUSINESS KernelError when a dirty tree would be overwritten", async () => {
		const repoDir = initRepo();
		setupDirtyTreeConflict(repoDir);
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(repoDir);

		await expect(
			repository.methods.checkout({ directory: repoDir, branch: "feature" }),
		).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
			message:
				"Unable to switch branches as there are working directory changes which would be overwritten. Please commit or stash your changes.",
		});
	});
});

describe("kilo.git repository init", () => {
	it("initializes a plain folder into an unborn repository on the default branch", async () => {
		const plainDir = createTempDir();
		fs.writeFileSync(path.join(plainDir, "README.md"), "hello\n");
		const { repository, addWorkspaceFolder } = await boot();
		addWorkspaceFolder(plainDir);

		await withGitConfig("", async () => {
			await repository.methods.init({ directory: plainDir });

			// The literal `main` fallback: no configured default.
			expect(execGitOutput(plainDir, ["symbolic-ref", "HEAD"])).toBe("refs/heads/main");
			const repositoryType = await repository.methods.repositoryType({ directory: plainDir });
			expect(repositoryType).toMatchObject({
				kind: "regular",
				topLevelWorkingDirectory: plainDir,
			});
			const status = await repository.methods.status({ directory: plainDir });
			// Unborn, but git still reports the branch HEAD points at, and
			// every file reads as untracked.
			expect(status).toMatchObject({
				exists: true,
				currentBranch: "main",
				workingDirectory: { files: [{ path: "README.md", status: { kind: "Untracked" } }] },
			});
		});
	});

	it("rejects an empty working directory at the domain boundary", async () => {
		const { repository } = await boot();

		await expect(repository.methods.init({ directory: "" })).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
	});

	it("rejects init for a directory outside every workspace folder", async () => {
		const plainDir = createTempDir();
		const { repository } = await boot();

		await expect(repository.methods.init({ directory: plainDir })).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
	});
});
