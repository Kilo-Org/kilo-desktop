import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	createFakeMainSdk,
	createFakeMainSdkProtocol,
	createLinkedFakeSdkPair,
} from "@kilo-desktop/testing";

import type { GitCapabilities } from "../contracts/schemas.js";
import { mainRegister } from "./index.js";

const directories: string[] = [];

afterEach(() => {
	// Windows: AV scanners and just-exited git processes can hold handles
	// briefly — retry like git-client's test util does.
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});

function createTempDir(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "git-plugin-"));
	directories.push(directory);
	return directory;
}

function execGit(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "pipe" });
}

function execGitOutput(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
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

/**
 * Boots git's mainRegister with a kilo-ui workspaces capability sharing the
 * same registry, mirroring the real app's wiring. `addWorkspaceFolder`
 * registers a folder the service's containment check may then see — tests
 * call it with the directory they are about to operate on, exactly like the
 * renderer only ever passes workspace folder paths.
 */
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

function bootedSdk() {
	const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "git" });
	const workspaceFolders: string[] = [];
	createMainSdk("kilo-ui").plugins.expose("workspaceService", {
		list: async () => [{ folders: workspaceFolders.map((folder) => ({ path: folder })) }],
	});
	mainRegister(mainSdk);
	return {
		mainSdk,
		addWorkspaceFolder: (folder: string) => {
			workspaceFolders.push(folder);
		},
	};
}

function bootedSdkWithProtocol() {
	const protocol = createFakeMainSdkProtocol();
	const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({
		featureId: "git",
		main: { protocol },
	});
	const workspaceFolders: string[] = [];
	createMainSdk("kilo-ui").plugins.expose("workspaceService", {
		list: async () => [{ folders: workspaceFolders.map((folder) => ({ path: folder })) }],
	});
	mainRegister(mainSdk);
	return {
		mainSdk,
		protocol,
		addWorkspaceFolder: (folder: string) => {
			workspaceFolders.push(folder);
		},
	};
}

describe("git mainRegister", () => {
	it("registers the status channel and reports a clean repository", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		expect(mainSdk.has("status")).toBe(true);

		await expect(mainSdk.invoke("status", { workingDirectory: repoDir })).resolves.toMatchObject({
			exists: true,
			currentBranch: "main",
			doConflictedFilesExist: false,
			workingDirectory: { files: [] },
		});

		mainSdk.dispose();
	});

	it("reports an untracked file as a working-directory change", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "notes.txt"), "hello");
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await expect(mainSdk.invoke("status", { workingDirectory: repoDir })).resolves.toMatchObject({
			exists: true,
			workingDirectory: {
				files: [{ path: "notes.txt", status: { kind: "Untracked" } }],
			},
		});

		mainSdk.dispose();
	});

	it("resolves null for a directory that is not a git repository", async () => {
		const plainDir = createTempDir();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(plainDir);

		await expect(mainSdk.invoke("status", { workingDirectory: plainDir })).resolves.toBe(null);

		mainSdk.dispose();
	});

	it("rejects an empty working directory at the routing boundary", async () => {
		const { mainSdk } = bootedSdk();

		await expect(mainSdk.invoke("status", { workingDirectory: "" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});

		mainSdk.dispose();
	});

	it("exposes the gitService capability for other plugins to consume", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		const gitService = mainSdk.plugins.get<GitCapabilities>("git")?.gitService;
		expect(gitService).toBeDefined();

		await expect(gitService!.status(repoDir)).resolves.toMatchObject({
			exists: true,
			workingDirectory: { files: [] },
		});
		await expect(gitService!.available()).resolves.toBe(true);

		mainSdk.dispose();
	});

	it("registers the available channel and reports git as available", async () => {
		const { mainSdk } = bootedSdk();

		expect(mainSdk.has("available")).toBe(true);
		await expect(mainSdk.invoke("available")).resolves.toBe(true);

		mainSdk.dispose();
	});

	it("invokes getDiffContents and returns both sides for a modified file", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "README.md"), "committed\n");
		execGit(repoDir, ["add", "README.md"]);
		commit(repoDir, "add readme");
		fs.writeFileSync(path.join(repoDir, "README.md"), "on disk\n");
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		expect(mainSdk.has("getDiffContents")).toBe(true);
		await expect(
			mainSdk.invoke("getDiffContents", { workingDirectory: repoDir, path: "README.md" }),
		).resolves.toEqual({ oldContents: "committed\n", newContents: "on disk\n" });

		mainSdk.dispose();
	});

	it("resolves null newContents for a deleted file and null oldContents for an untracked file", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "deleted.txt"), "committed\n");
		fs.writeFileSync(path.join(repoDir, "untracked.txt"), "never committed\n");
		execGit(repoDir, ["add", "deleted.txt"]);
		commit(repoDir, "add deleted");
		fs.rmSync(path.join(repoDir, "deleted.txt"));
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await expect(
			mainSdk.invoke("getDiffContents", { workingDirectory: repoDir, path: "deleted.txt" }),
		).resolves.toEqual({ oldContents: "committed\n", newContents: null });
		await expect(
			mainSdk.invoke("getDiffContents", { workingDirectory: repoDir, path: "untracked.txt" }),
		).resolves.toEqual({ oldContents: null, newContents: "never committed\n" });

		mainSdk.dispose();
	});

	it("rejects an empty path with VALIDATION at the routing boundary", async () => {
		const { mainSdk } = bootedSdk();

		await expect(
			mainSdk.invoke("getDiffContents", { workingDirectory: "/repos/project", path: "" }),
		).rejects.toMatchObject({ name: "FeatureError", code: "VALIDATION" });

		mainSdk.dispose();
	});

	it("fails closed when no workspaces capability is exposed", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "git" });
		mainRegister(mainSdk);

		await expect(
			mainSdk.invoke("status", { workingDirectory: "/repos/project" }),
		).rejects.toMatchObject({ name: "FeatureError", code: "VALIDATION" });

		mainSdk.dispose();
	});

	it("rejects status for a directory outside every workspace folder", async () => {
		const repoDir = initRepo();
		const otherDir = createTempDir();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(otherDir);

		await expect(mainSdk.invoke("status", { workingDirectory: repoDir })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});

		mainSdk.dispose();
	});

	it("registers the kilo-git protocol handler when a protocol delegate exists", async () => {
		const { mainSdk, protocol } = bootedSdkWithProtocol();
		expect(protocol.handler).toBeTypeOf("function");

		const handler = protocol.handler!;
		const response = await handler(new Request("kilo-git://diff/patch"));
		// cwd is validated before the service runs, with no filesystem needed.
		expect(response.status).toBe(400);

		mainSdk.dispose();
	});

	it("streams the working-tree patch through the registered handler", async () => {
		const repoDir = initRepo();
		fs.writeFileSync(path.join(repoDir, "README.md"), "hello\n");
		const { mainSdk, protocol, addWorkspaceFolder } = bootedSdkWithProtocol();
		addWorkspaceFolder(repoDir);

		const response = await protocol.handler!(
			new Request(`kilo-git://diff/patch?cwd=${encodeURIComponent(repoDir)}`),
		);
		expect(response.status).toBe(200);
		const patch = await response.text();
		expect(patch).toContain("diff --git a/README.md b/README.md");
		expect(patch).toContain("+hello");
		expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");

		mainSdk.dispose();
	});

	it("serves an empty 200 body for a clean working tree", async () => {
		const repoDir = initRepo();
		const { mainSdk, protocol, addWorkspaceFolder } = bootedSdkWithProtocol();
		addWorkspaceFolder(repoDir);

		const response = await protocol.handler!(
			new Request(`kilo-git://diff/patch?cwd=${encodeURIComponent(repoDir)}`),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");

		mainSdk.dispose();
	});

	it("responds 404 through the handler for a non-repository directory", async () => {
		const plainDir = createTempDir();
		const { mainSdk, protocol, addWorkspaceFolder } = bootedSdkWithProtocol();
		addWorkspaceFolder(plainDir);

		const response = await protocol.handler!(
			new Request(`kilo-git://diff/patch?cwd=${encodeURIComponent(plainDir)}`),
		);
		expect(response.status).toBe(404);
		expect(await response.text()).toContain("Not a git repository");

		mainSdk.dispose();
	});

	it("responds 403 through the handler for a directory outside every workspace folder", async () => {
		const repoDir = initRepo();
		const otherDir = createTempDir();
		const { mainSdk, protocol, addWorkspaceFolder } = bootedSdkWithProtocol();
		addWorkspaceFolder(otherDir);

		const response = await protocol.handler!(
			new Request(`kilo-git://diff/patch?cwd=${encodeURIComponent(repoDir)}`),
		);
		expect(response.status).toBe(403);
		expect(await response.text()).toContain("not inside a workspace folder");

		mainSdk.dispose();
	});
});

describe("git mainRegister branches", () => {
	it("reports the current branch alongside the branch list", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		expect(mainSdk.has("branches")).toBe(true);
		await withGitConfig("", async () => {
			const result = await mainSdk.invoke("branches", { workingDirectory: repoDir });

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

		mainSdk.dispose();
	});

	it("detects the configured default branch from global config", async () => {
		const repoDir = createTempDir();
		execGit(repoDir, ["init", "-b", "trunk"]);
		execGit(repoDir, ["config", "user.email", "git-plugin@example.com"]);
		execGit(repoDir, ["config", "user.name", "Git Plugin Test"]);
		commit(repoDir, "initial");
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await withGitConfig("[init]\n\tdefaultBranch = trunk\n", async () => {
			const result = await mainSdk.invoke("branches", { workingDirectory: repoDir });
			expect(result).toMatchObject({ defaultBranch: "trunk" });
		});

		mainSdk.dispose();
	});

	it("detects the remote HEAD as the default and resolves recency from real checkouts", async () => {
		const cloneDir = cloneWithCheckoutHistory();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(cloneDir);

		await withGitConfig("", async () => {
			const result = await mainSdk.invoke("branches", { workingDirectory: cloneDir });

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

		mainSdk.dispose();
	});

	it("resolves null for a directory that is not a git repository", async () => {
		const plainDir = createTempDir();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(plainDir);

		await expect(mainSdk.invoke("branches", { workingDirectory: plainDir })).resolves.toBe(null);

		mainSdk.dispose();
	});

	it("lists remote-tracking branches that no local branch tracks", async () => {
		const cloneDir = cloneWithUntrackedRemoteFeature();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(cloneDir);

		const result = await mainSdk.invoke("branches", { workingDirectory: cloneDir });

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

		mainSdk.dispose();
	});
});

describe("git mainRegister repositoryType", () => {
	it("registers the repositoryType channel and classifies a regular repository", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		expect(mainSdk.has("repositoryType")).toBe(true);
		await expect(mainSdk.invoke("repositoryType", { workingDirectory: repoDir })).resolves.toEqual({
			kind: "regular",
			topLevelWorkingDirectory: repoDir,
			gitDir: path.join(repoDir, ".git"),
		});

		mainSdk.dispose();
	});

	it("resolves missing for a directory that is not a git repository", async () => {
		const plainDir = createTempDir();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(plainDir);

		await expect(mainSdk.invoke("repositoryType", { workingDirectory: plainDir })).resolves.toEqual(
			{ kind: "missing" },
		);

		mainSdk.dispose();
	});
});

describe("git mainRegister defaultBranch", () => {
	it("resolves the default branch for a regular repository", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		expect(mainSdk.has("defaultBranch")).toBe(true);
		await expect(mainSdk.invoke("defaultBranch", { workingDirectory: repoDir })).resolves.toBe(
			"main",
		);

		mainSdk.dispose();
	});

	it("resolves null outside a repository", async () => {
		const plainDir = createTempDir();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(plainDir);

		await expect(
			mainSdk.invoke("defaultBranch", { workingDirectory: plainDir }),
		).resolves.toBeNull();

		mainSdk.dispose();
	});

	it("rejects a directory outside every workspace folder", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await expect(
			mainSdk.invoke("defaultBranch", { workingDirectory: createTempDir() }),
		).rejects.toMatchObject({ name: "FeatureError", code: "VALIDATION" });

		mainSdk.dispose();
	});
});

describe("git mainRegister gitService capability", () => {
	it("exposes the worktree methods via plugins.get", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		const capabilities = mainSdk.plugins.get<GitCapabilities>("git");
		expect(capabilities).not.toBeNull();

		const worktree = await capabilities?.gitService.createWorktree({ workingDirectory: repoDir });
		expect(worktree?.directory).toMatch(/[/].kilo[/]worktrees[/]kilo-/);
		expect(worktree?.branch).toMatch(/^kilo\//);

		// The created worktree is a real git worktree on a kilo/ branch.
		const listing = execGitOutput(repoDir, ["worktree", "list", "--porcelain"]);
		expect(listing).toContain(worktree?.directory ?? "");
		const branches = execGitOutput(repoDir, [
			"for-each-ref",
			"--format=%(refname:short)",
			"refs/heads",
		]);
		expect(branches.split("\n")).toContain(worktree?.branch);

		// Removing it prunes both the directory and the branch.
		await capabilities?.gitService.removeWorktree({ path: worktree?.directory ?? "" });
		expect(fs.existsSync(worktree?.directory ?? "")).toBe(false);
		const branchesAfter = execGitOutput(repoDir, [
			"for-each-ref",
			"--format=%(refname:short)",
			"refs/heads",
		]);
		expect(branchesAfter.split("\n")).not.toContain(worktree?.branch);

		mainSdk.dispose();
	});

	it("appends .kilo/worktrees/ to the repository's exclude file", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		const capabilities = mainSdk.plugins.get<GitCapabilities>("git");
		const worktree = await capabilities?.gitService.createWorktree({ workingDirectory: repoDir });
		const exclude = fs.readFileSync(path.join(repoDir, ".git", "info", "exclude"), "utf-8");
		expect(exclude).toContain(".kilo/worktrees/");

		await capabilities?.gitService.removeWorktree({ path: worktree?.directory ?? "" });
		mainSdk.dispose();
	});

	it("falls back to the local base with a warning when fetching the remote fails", async () => {
		const repoDir = initRepo();
		execGit(repoDir, ["remote", "add", "origin", path.join(createTempDir(), "no-such-remote")]);
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		const capabilities = mainSdk.plugins.get<GitCapabilities>("git");
		const worktree = await capabilities?.gitService.createWorktree({ workingDirectory: repoDir });

		expect(worktree?.warning).toBe(
			"Could not fetch latest main from origin; branched from local state.",
		);
		// The degraded base still yields a healthy worktree on the local main.
		const listing = execGitOutput(repoDir, ["worktree", "list", "--porcelain"]);
		expect(listing).toContain(worktree?.directory ?? "");

		await capabilities?.gitService.removeWorktree({ path: worktree?.directory ?? "" });
		mainSdk.dispose();
	});

	it("bases remote-tracking start points on a commit so semantic rename stays eligible", async () => {
		const repoDir = initRepo();
		// A bare clone acts as a real (local) remote the fetch can succeed on.
		const remoteDir = createTempDir();
		execGit(os.tmpdir(), ["clone", "--bare", repoDir, remoteDir]);
		execGit(repoDir, ["remote", "add", "origin", remoteDir]);
		execGit(repoDir, ["fetch", "origin"]);
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		const capabilities = mainSdk.plugins.get<GitCapabilities>("git");
		const worktree = await capabilities?.gitService.createWorktree({ workingDirectory: repoDir });

		expect(worktree?.warning).toBeUndefined();
		// Without the `^{commit}` dereference, `worktree add -b <branch> origin/main`
		// sets upstream tracking on the new branch, and the no-upstream guard
		// would decline every semantic rename for that session.
		const upstream = execGitOutput(repoDir, [
			"for-each-ref",
			"--format=%(upstream:short)",
			`refs/heads/${worktree?.branch ?? ""}`,
		]);
		expect(upstream).toBe("");

		const rename = await capabilities?.gitService.renameWorktreeBranch({
			path: worktree?.directory ?? "",
			currentBranch: worktree?.branch ?? "",
			requestedBranch: "Fix the Login Bug!",
		});
		expect(rename).toEqual({ branch: "kilo/fix-the-login-bug" });

		await capabilities?.gitService.removeWorktree({ path: worktree?.directory ?? "" });
		mainSdk.dispose();
	});

	it("emits worktree-branch-renamed when a rename succeeds", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		const capabilities = mainSdk.plugins.get<GitCapabilities>("git");
		const worktree = await capabilities?.gitService.createWorktree({ workingDirectory: repoDir });

		const events: unknown[] = [];
		mainSdk.events.on("git.worktree-branch-renamed", (payload) => {
			events.push(payload);
		});

		const renamed = await capabilities?.gitService.renameWorktreeBranch({
			path: worktree?.directory ?? "",
			currentBranch: worktree?.branch ?? "",
			requestedBranch: "Fix the Login Bug!",
		});
		expect(renamed).toEqual({ branch: "kilo/fix-the-login-bug" });
		expect(events).toEqual([{ path: worktree?.directory, branch: "kilo/fix-the-login-bug" }]);

		await capabilities?.gitService.removeWorktree({ path: worktree?.directory ?? "" });
		mainSdk.dispose();
	});

	it("does not emit worktree-branch-renamed when rename returns null", async () => {
		const repoDir = initRepo();
		const { mainSdk } = bootedSdk();

		const capabilities = mainSdk.plugins.get<GitCapabilities>("git");

		const events: unknown[] = [];
		mainSdk.events.on("git.worktree-branch-renamed", (payload) => {
			events.push(payload);
		});

		// Rename against the main checkout (not a managed worktree) → null.
		const result = await capabilities?.gitService.renameWorktreeBranch({
			path: repoDir,
			currentBranch: "main",
			requestedBranch: "some-name",
		});
		expect(result).toBeNull();
		expect(events).toHaveLength(0);

		mainSdk.dispose();
	});
});

describe("git mainRegister checkout", () => {
	it("checks out a remote-tracking branch as a local tracking branch", async () => {
		const cloneDir = cloneWithUntrackedRemoteFeature();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(cloneDir);

		await mainSdk.invoke("checkout", {
			workingDirectory: cloneDir,
			branch: "origin/feature",
			kind: "remote",
		});

		const branches = await mainSdk.invoke("branches", { workingDirectory: cloneDir });
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

		mainSdk.dispose();
	});

	it("creates and switches to a new branch, then switches back", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await mainSdk.invoke("checkout", {
			workingDirectory: repoDir,
			branch: "feature",
			create: true,
		});

		let branches = await mainSdk.invoke("branches", { workingDirectory: repoDir });
		expect(branches).toMatchObject({ currentBranch: "feature" });
		expect(branches).toMatchObject({
			branches: expect.arrayContaining([expect.objectContaining({ name: "feature" })]),
		});

		await mainSdk.invoke("checkout", { workingDirectory: repoDir, branch: "main" });
		branches = await mainSdk.invoke("branches", { workingDirectory: repoDir });
		expect(branches).toMatchObject({ currentBranch: "main" });

		mainSdk.dispose();
	});

	it("rejects when checking out a branch that does not exist", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await expect(
			mainSdk.invoke("checkout", { workingDirectory: repoDir, branch: "missing" }),
		).rejects.toThrow();

		mainSdk.dispose();
	});

	it("creates the branch off the named start point's tip", async () => {
		const repoDir = initRepo();
		execGit(repoDir, ["checkout", "-b", "feature"]);
		commit(repoDir, "feature change");
		const mainTip = execGitOutput(repoDir, ["rev-parse", "main"]);
		const featureTip = execGitOutput(repoDir, ["rev-parse", "feature"]);
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await mainSdk.invoke("checkout", {
			workingDirectory: repoDir,
			branch: "topic",
			create: true,
			startPoint: "main",
		});

		const branches = await mainSdk.invoke("branches", { workingDirectory: repoDir });
		expect(branches).toMatchObject({
			branches: expect.arrayContaining([
				expect.objectContaining({ name: "topic", tip: { sha: mainTip } }),
			]),
		});
		// HEAD (feature) has its own commit, so the tip equality above proves
		// the start point — not the current HEAD — anchored the branch.
		expect(mainTip).not.toBe(featureTip);

		mainSdk.dispose();
	});

	it("rejects with a BUSINESS FeatureError when creating an existing branch name", async () => {
		const repoDir = initRepo();
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await expect(
			mainSdk.invoke("checkout", { workingDirectory: repoDir, branch: "main", create: true }),
		).rejects.toMatchObject({
			name: "FeatureError",
			code: "BUSINESS",
			message: "A branch with that name already exists.",
		});

		mainSdk.dispose();
	});

	it("rejects with a BUSINESS FeatureError when a dirty tree would be overwritten", async () => {
		const repoDir = initRepo();
		setupDirtyTreeConflict(repoDir);
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(repoDir);

		await expect(
			mainSdk.invoke("checkout", { workingDirectory: repoDir, branch: "feature" }),
		).rejects.toMatchObject({
			name: "FeatureError",
			code: "BUSINESS",
			message:
				"Unable to switch branches as there are working directory changes which would be overwritten. Please commit or stash your changes.",
		});

		mainSdk.dispose();
	});
});

describe("git mainRegister init", () => {
	it("initializes a plain folder into an unborn repository on the default branch", async () => {
		const plainDir = createTempDir();
		fs.writeFileSync(path.join(plainDir, "README.md"), "hello\n");
		const { mainSdk, addWorkspaceFolder } = bootedSdk();
		addWorkspaceFolder(plainDir);

		expect(mainSdk.has("init")).toBe(true);

		await withGitConfig("", async () => {
			await mainSdk.invoke("init", { workingDirectory: plainDir });

			// The literal `main` fallback: no configured default.
			expect(execGitOutput(plainDir, ["symbolic-ref", "HEAD"])).toBe("refs/heads/main");
			const repositoryType = await mainSdk.invoke("repositoryType", {
				workingDirectory: plainDir,
			});
			expect(repositoryType).toMatchObject({
				kind: "regular",
				topLevelWorkingDirectory: plainDir,
			});
			const status = await mainSdk.invoke("status", { workingDirectory: plainDir });
			// Unborn, but git still reports the branch HEAD points at, and
			// every file reads as untracked.
			expect(status).toMatchObject({
				exists: true,
				currentBranch: "main",
				workingDirectory: { files: [{ path: "README.md", status: { kind: "Untracked" } }] },
			});
		});

		mainSdk.dispose();
	});

	it("rejects an empty working directory at the routing boundary", async () => {
		const { mainSdk } = bootedSdk();

		await expect(mainSdk.invoke("init", { workingDirectory: "" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});

		mainSdk.dispose();
	});

	it("rejects init for a directory outside every workspace folder", async () => {
		const plainDir = createTempDir();
		const { mainSdk } = bootedSdk();

		await expect(mainSdk.invoke("init", { workingDirectory: plainDir })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});

		mainSdk.dispose();
	});
});
