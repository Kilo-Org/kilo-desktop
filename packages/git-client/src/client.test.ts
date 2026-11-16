import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "./client.js";
import { ExecError, GitNotDetectedError, UnsupportedGitVersionError } from "./exec/errors.js";
import { noopLogger } from "./test/util.js";

const directories: string[] = [];

afterEach(() => {
	for (const dir of directories.splice(0)) {
		// Retries absorb the EPERM/EBUSY Windows throws when a just-finished
		// git process (or an indexer) still holds a handle inside the tree.
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});

function createDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	directories.push(dir);
	return dir;
}

describe("createGitClient", () => {
	it("defaults the working directory to process.cwd()", () => {
		expect(createGitClient().path).toBe(process.cwd());
	});

	it("uses the given working directory", () => {
		const path = createDir("desktop-git-client-path");
		expect(createGitClient({ path }).path).toBe(path);
	});

	it("executes git in the working directory", async () => {
		const path = createDir("desktop-git-client-exec");
		const git = createGitClient({ path, logger: noopLogger });

		await git.exec(["init"], "init");
		const result = await git.exec(["status", "--porcelain"], "status");

		expect(result.exitCode).toBe(0);
	});

	it("applies client-level env to every invocation", async () => {
		const path = createDir("desktop-git-client-env");
		const git = createGitClient({
			path,
			logger: noopLogger,
			env: {
				GIT_AUTHOR_NAME: "Client Name",
				GIT_AUTHOR_EMAIL: "client@example.com",
				GIT_AUTHOR_DATE: "Wed, 05 Oct 2016 23:33:27 +0200",
			},
		});

		const result = await git.exec(["var", "GIT_AUTHOR_IDENT"], "author ident");
		expect(result.stdout).toBe("Client Name <client@example.com> 1475703207 +0200\n");
	});

	it("lets per-call env override client-level env", async () => {
		const path = createDir("desktop-git-client-env-override");
		const git = createGitClient({
			path,
			logger: noopLogger,
			env: {
				GIT_AUTHOR_NAME: "Client Name",
				GIT_AUTHOR_EMAIL: "client@example.com",
				GIT_AUTHOR_DATE: "Wed, 05 Oct 2016 23:33:27 +0200",
			},
		});

		const result = await git.exec(["var", "GIT_AUTHOR_IDENT"], "author ident", {
			env: { GIT_AUTHOR_NAME: "Call Name" },
		});
		expect(result.stdout).toBe("Call Name <client@example.com> 1475703207 +0200\n");
	});

	it("executes git in the per-call cwd when given", async () => {
		const clientPath = createDir("desktop-git-client-cwd-client");
		const cwd = createDir("desktop-git-client-cwd-exec");
		const git = createGitClient({ path: clientPath, logger: noopLogger });

		await git.exec(["init"], "init", { cwd });
		const result = await git.exec(["rev-parse", "--show-toplevel"], "toplevel", { cwd });

		expect(result.path).toBe(cwd);
		// realpathSync.native expands 8.3 short names (e.g. RUNNER~1 in CI's TEMP)
		// to the long form git prints; plain realpathSync leaves them as-is.
		expect(realpathSync.native(result.stdout.trim())).toBe(realpathSync.native(cwd));
	});

	it("executes git in the client path when no cwd is given", async () => {
		const path = createDir("desktop-git-client-no-cwd");
		const git = createGitClient({ path, logger: noopLogger });

		const result = await git.exec(["--version"], "version");

		expect(result.path).toBe(path);
	});

	it("returns buffer output with the buffer encoding", async () => {
		const git = createGitClient({ logger: noopLogger });
		const result = await git.exec(["--version"], "version", { encoding: "buffer" });
		expect(result.stdout).toBeInstanceOf(Buffer);
		expect(result.stdout.toString().includes("git version")).toBe(true);
	});

	it("rejects with GitNotDetectedError when git cannot be resolved", async () => {
		const emptyPath = createDir("desktop-git-client-empty-path");
		const git = createGitClient({ env: { PATH: emptyPath }, logger: noopLogger });

		await expect(git.exec(["--version"], "version")).rejects.toThrowError(GitNotDetectedError);
	});

	it.skipIf(process.platform === "win32")(
		"keeps reporting GitNotDetectedError after git appears on the PATH",
		async () => {
			const binDir = createDir("desktop-git-client-late-git");
			const git = createGitClient({ env: { PATH: binDir }, logger: noopLogger });

			await expect(git.exec(["--version"], "version")).rejects.toThrowError(GitNotDetectedError);
			const fakeGit = join(binDir, "git");
			writeFileSync(fakeGit, "#!/bin/sh\necho 'git version 2.39.5'\n");
			chmodSync(fakeGit, 0o755);

			await expect(git.exec(["--version"], "version")).rejects.toThrowError(GitNotDetectedError);
		},
	);

	it("throws ExecError when an explicit gitPath cannot be executed", async () => {
		const path = createDir("desktop-git-client-bad-git-path");
		const git = createGitClient({ path, gitPath: "/no/such/git-binary", logger: noopLogger });

		const error = await git.exec(["--version"], "version").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ExecError);
		expect((error as ExecError).code).toBe("ENOENT");
	});

	it("throws ExecError when LOCAL_GIT_DIRECTORY resolves a missing binary", async () => {
		const path = createDir("desktop-git-client-local-git-dir");
		const git = createGitClient({ path, env: { LOCAL_GIT_DIRECTORY: path }, logger: noopLogger });

		const error = await git.exec(["--version"], "version").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ExecError);
		expect((error as ExecError).code).toBe("ENOENT");
	});

	describe("status", () => {
		it("reports the status of the per-call cwd repository", async () => {
			const clientPath = createDir("desktop-git-client-status-cwd-client");
			const cwd = createDir("desktop-git-client-status-cwd-exec");
			const git = createGitClient({ path: clientPath, logger: noopLogger });

			await git.exec(["init"], "init", { cwd });
			const result = await git.status({ cwd });

			expect(result).not.toBeNull();
			expect(result?.exists).toBe(true);
		});

		it("still uses the client path when no cwd is given", async () => {
			const path = createDir("desktop-git-client-status-no-cwd");
			const git = createGitClient({ path, logger: noopLogger });

			await git.exec(["init"], "init");
			const result = await git.status();

			expect(result).not.toBeNull();
			expect(result?.exists).toBe(true);
		});

		it("resolves null outside a repository", async () => {
			const cwd = createDir("desktop-git-client-status-null");
			const git = createGitClient({ logger: noopLogger });

			expect(await git.status({ cwd })).toBeNull();
		});
	});

	describe("repositoryType", () => {
		it("returns regular for the bound repository", async () => {
			const path = createDir("desktop-git-client-repository-type");
			const git = createGitClient({ path, logger: noopLogger });

			await git.exec(["init"], "init");
			const result = await git.repositoryType();

			expect(result).toMatchObject({ kind: "regular", topLevelWorkingDirectory: path });
		});

		it("returns missing for a given path that is not a repository", async () => {
			const clientPath = createDir("desktop-git-client-repository-type-client");
			const otherPath = createDir("desktop-git-client-repository-type-other");
			const git = createGitClient({ path: clientPath, logger: noopLogger });

			await expect(git.repositoryType(otherPath)).resolves.toEqual({ kind: "missing" });
		});
	});

	describe("version", () => {
		it("returns a coerced semver string", async () => {
			const git = createGitClient();
			const version = await git.version();
			expect(version).toMatch(/^\d+\.\d+\.\d+$/);
		});

		it("memoizes the resolved version", () => {
			const git = createGitClient();
			expect(git.version()).toBe(git.version());
		});

		it("checks the git version against a semver range", async () => {
			const git = createGitClient();
			await expect(git.satisfies(">=0.0.1")).resolves.toBe(true);
			await expect(git.satisfies("^99.0.0")).resolves.toBe(false);
		});
	});

	describe("minimum version", () => {
		it("rejects every command when git is older than the minimum", async () => {
			const path = createDir("desktop-git-client-min-version");
			const git = createGitClient({ path, minimumVersion: "99.0.0", logger: noopLogger });
			const installed = await git.version();

			const execError = await git.exec(["init"], "init").catch((e: unknown) => e);
			const statusError = await git.status().catch((e: unknown) => e);

			for (const error of [execError, statusError]) {
				expect(error).toBeInstanceOf(UnsupportedGitVersionError);
				expect(error).toMatchObject({ version: installed, minimumVersion: "99.0.0" });
			}
		});

		it("runs commands when git meets the minimum", async () => {
			const path = createDir("desktop-git-client-min-version-ok");
			const git = createGitClient({ path, minimumVersion: "0.0.1", logger: noopLogger });

			await expect(git.exec(["init"], "init")).resolves.toMatchObject({ exitCode: 0 });
		});
	});
});
