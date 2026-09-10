import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	createFakeMainSdk,
	createFakeMainSdkProtocol,
	createLinkedFakeSdkPair,
} from "@anaconda-agentic-desktop/testing";

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
