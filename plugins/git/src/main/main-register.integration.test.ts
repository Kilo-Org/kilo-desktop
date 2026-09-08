import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

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

function bootedSdk() {
	const mainSdk = createFakeMainSdk({ featureId: "git" });
	mainRegister(mainSdk);
	return mainSdk;
}

describe("git mainRegister", () => {
	it("registers the status channel and reports a clean repository", async () => {
		const repoDir = initRepo();
		const mainSdk = bootedSdk();

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
		const mainSdk = bootedSdk();

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
		const mainSdk = bootedSdk();

		await expect(mainSdk.invoke("status", { workingDirectory: plainDir })).resolves.toBe(null);

		mainSdk.dispose();
	});

	it("rejects an empty working directory at the routing boundary", async () => {
		const mainSdk = bootedSdk();

		await expect(mainSdk.invoke("status", { workingDirectory: "" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});

		mainSdk.dispose();
	});

	it("registers the available channel and reports git as available", async () => {
		const mainSdk = bootedSdk();

		expect(mainSdk.has("available")).toBe(true);
		await expect(mainSdk.invoke("available")).resolves.toBe(true);

		mainSdk.dispose();
	});
});
