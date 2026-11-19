import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { bootGit, stopBootedKernels } from "../repository/test-boot";

const REMOTE_URL = "https://git.example.invalid/acme/app.git";
const directories: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	await stopBootedKernels();
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});

function createTempDir(): string {
	const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "git-clone-")));
	directories.push(directory);
	return directory;
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}

/**
 * A bare repository with one commit, reachable as {@link REMOTE_URL}: git's
 * `insteadOf` (set through the environment, which git inherits) rewrites the
 * remote URL people paste to the local folder, since local paths aren't
 * accepted as clone URLs.
 */
function servedRemote(): string {
	const source = createTempDir();
	git(source, ["init", "-b", "main"]);
	git(source, ["config", "user.email", "git-plugin@example.com"]);
	git(source, ["config", "user.name", "Git Plugin Test"]);
	fs.writeFileSync(path.join(source, "README.md"), "# app\n");
	git(source, ["add", "README.md"]);
	git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);
	const remote = createTempDir();
	git(remote, ["clone", "--bare", source, "."]);
	vi.stubEnv("GIT_CONFIG_COUNT", "1");
	vi.stubEnv("GIT_CONFIG_KEY_0", `url.${remote}.insteadOf`);
	vi.stubEnv("GIT_CONFIG_VALUE_0", REMOTE_URL);
	return remote;
}

describe("cloning a repository into a new workspace", () => {
	it("provides the GitHub repositories, checking input before asking the GitHub CLI", async () => {
		const booted = await bootGit();

		expect(booted.githubRepositories).not.toBeNull();
		await expect(
			booted.githubRepositories!.methods.resolve({ repository: "not a repo" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("clones a Git URL into <parent>/<name> and creates a workspace of it", async () => {
		servedRemote();
		const parent = createTempDir();
		const booted = await bootGit();

		const workspace = await booted.repository.methods.cloneWorkspace({
			source: { kind: "url", url: REMOTE_URL },
			name: "app",
			parentPath: parent,
		});

		const destination = path.join(parent, "app");
		expect(fs.readFileSync(path.join(destination, "README.md"), "utf8")).toBe("# app\n");
		expect(git(destination, ["config", "--get", "remote.origin.url"])).toBe(REMOTE_URL);
		expect(workspace).toMatchObject({ name: "app", folders: [{ path: destination }] });
		expect(booted.created).toHaveLength(1);
		expect(booted.rememberedLocations).toEqual([parent]);
	});

	it("rejects a local path as a clone URL without creating anything", async () => {
		const remote = servedRemote();
		const parent = createTempDir();
		const booted = await bootGit();

		await expect(
			booted.repository.methods.cloneWorkspace({
				source: { kind: "url", url: remote },
				name: "app",
				parentPath: parent,
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(fs.existsSync(path.join(parent, "app"))).toBe(false);
		expect(booted.created).toEqual([]);
	});

	it("explains a remote that is not a repository, leaving no folder behind", async () => {
		const parent = createTempDir();
		vi.stubEnv("GIT_CONFIG_COUNT", "1");
		vi.stubEnv("GIT_CONFIG_KEY_0", `url.${createTempDir()}.insteadOf`);
		vi.stubEnv("GIT_CONFIG_VALUE_0", REMOTE_URL);
		const booted = await bootGit();

		await expect(
			booted.repository.methods.cloneWorkspace({
				source: { kind: "url", url: REMOTE_URL },
				name: "app",
				parentPath: parent,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(fs.existsSync(path.join(parent, "app"))).toBe(false);
		expect(booted.created).toEqual([]);
	});

	it("is unavailable while workspaces are absent", async () => {
		const parent = createTempDir();
		const booted = await bootGit({ workSessions: false });

		await expect(
			booted.repository.methods.cloneWorkspace({
				source: { kind: "url", url: REMOTE_URL },
				name: "app",
				parentPath: parent,
			}),
		).rejects.toMatchObject({ code: "BUSINESS" });
		expect(fs.readdirSync(parent)).toEqual([]);
	});
});
