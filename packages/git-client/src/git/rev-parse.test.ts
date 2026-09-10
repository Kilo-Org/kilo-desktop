import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import { cleanupTestDirs, createTestDir, initialize, noopLogger } from "../test/util.js";
import { getRepositoryType } from "./rev-parse.js";
import type { RepositoryType, RevParseExec } from "./rev-parse.js";

afterEach(cleanupTestDirs);

/**
 * The real executor seam: a git-client bound to the probed path. The module
 * sets `cwd` itself, so the executor is the client's `exec` unmodified —
 * the git binary is the system boundary and is deliberately not mocked.
 */
function execFor(path: string): RevParseExec {
	const client = createGitClient({ path, logger: noopLogger });
	return (args, name, options) => client.exec(args, name, options);
}

/** Assert `kind: "regular"` and return the narrowed result. */
async function expectRegular(exec: RevParseExec, path: string) {
	const result = await getRepositoryType(exec, path);
	expect(result.kind).toBe("regular");
	if (result.kind !== "regular") {
		throw new Error("unreachable");
	}
	return result;
}

/** Assert a non-regular outcome. */
async function expectType(exec: RevParseExec, path: string, expected: RepositoryType) {
	await expect(getRepositoryType(exec, path)).resolves.toEqual(expected);
}

describe("git/rev-parse", () => {
	describe("getRepositoryType", () => {
		it("returns regular at the repository root", async () => {
			const repoPath = await initialize("rev-parse-regular", "main");

			const result = await expectRegular(execFor(repoPath), repoPath);

			// cdup resolution is syntactic, so the toplevel asserts by literal
			// equality; the git dir resolves through realpath because macOS temp
			// dirs live under /var -> /private/var (mirrors Desktop's test).
			expect(result.topLevelWorkingDirectory).toBe(repoPath);
			expect(await realpath(result.gitDir)).toBe(await realpath(join(repoPath, ".git")));
		});

		it("returns regular from a subdirectory, resolving the repository root", async () => {
			const repoPath = await initialize("rev-parse-subdir", "main");
			const subdir = join(repoPath, "subdir");
			await mkdir(subdir);

			const result = await expectRegular(execFor(subdir), subdir);

			expect(result.topLevelWorkingDirectory).toBe(repoPath);
			expect(await realpath(result.gitDir)).toBe(await realpath(join(repoPath, ".git")));
		});

		it("returns regular for an unborn repository", async () => {
			const repoPath = await initialize("rev-parse-unborn", "main");

			const result = await expectRegular(execFor(repoPath), repoPath);

			expect(result.topLevelWorkingDirectory).toBe(repoPath);
			expect(await realpath(result.gitDir)).toBe(await realpath(join(repoPath, ".git")));
		});

		it("returns bare for a bare repository", async () => {
			const repoPath = await createTestDir("desktop-git-test-rev-parse-bare");
			const client = createGitClient({ path: repoPath, logger: noopLogger });
			await client.exec(["init", "--bare"], "init");

			await expectType(execFor(repoPath), repoPath, { kind: "bare" });
		});

		it("returns missing for an empty directory", async () => {
			const dirPath = await createTestDir("desktop-git-test-rev-parse-empty");

			await expectType(execFor(dirPath), dirPath, { kind: "missing" });
		});

		it("returns missing for a nonexistent path", async () => {
			const rootPath = await createTestDir("desktop-git-test-rev-parse-nonexistent");
			const missingPath = join(rootPath, "missing-folder");

			await expectType(execFor(missingPath), missingPath, { kind: "missing" });
		});

		it("returns unsafe for a repository with dubious ownership", async () => {
			const repoPath = await initialize("rev-parse-unsafe", "main");

			const previousHome = process.env.HOME;
			// A stub global config clears any system `safe.directory=*` — the
			// `safe.directory` setting is ignored in local config, environment
			// variables and command line arguments, so HOME is the lever.
			const testHomeDirectory = await createTestDir("desktop-git-test-rev-parse-home");
			await writeFile(
				join(testHomeDirectory, ".gitconfig"),
				`[safe]
directory=`,
			);

			process.env.HOME = testHomeDirectory;
			process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";

			try {
				const result = await getRepositoryType(execFor(repoPath), repoPath);
				// git prints the dubious-ownership path from its own
				// resolution, which expands macOS temp symlinks.
				expect(result).toMatchObject({ kind: "unsafe" });
				if (result.kind === "unsafe") {
					expect(await realpath(result.path)).toBe(await realpath(repoPath));
				}
			} finally {
				delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
				if (previousHome === undefined) {
					delete process.env.HOME;
				} else {
					process.env.HOME = previousHome;
				}
			}
		});
	});
});
