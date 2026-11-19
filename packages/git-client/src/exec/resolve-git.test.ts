import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitNotDetectedError } from "./errors.js";
import { resolveGitBinary } from "./resolve-git.js";

const directories: string[] = [];

afterEach(() => {
	for (const dir of directories.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("resolveGitBinary", () => {
	it("returns an explicit gitPath as is", () => {
		expect(resolveGitBinary("/custom/path/to/git", {})).toBe("/custom/path/to/git");
	});

	it("prefers an explicit gitPath over LOCAL_GIT_DIRECTORY and PATH lookup", () => {
		const env = { LOCAL_GIT_DIRECTORY: tmpdir(), PATH: process.env["PATH"] };
		expect(resolveGitBinary("/custom/path/to/git", env)).toBe("/custom/path/to/git");
	});

	it("resolves LOCAL_GIT_DIRECTORY as a git installation directory", () => {
		const localGitDir = mkdtempSync(join(tmpdir(), "desktop-git-test-local-dir-"));
		directories.push(localGitDir);

		const location = resolveGitBinary(undefined, {
			LOCAL_GIT_DIRECTORY: localGitDir,
			PATH: process.env["PATH"],
		});

		const expected =
			process.platform === "win32"
				? join(localGitDir, "cmd", "git.exe")
				: join(localGitDir, "bin", "git");

		expect(location).toBe(expected);
	});

	it("falls back to looking up git on the PATH", () => {
		const location = resolveGitBinary(undefined, { PATH: process.env["PATH"] });
		expect(location.includes("git")).toBe(true);
	});

	it("throws GitNotDetectedError when git cannot be found", () => {
		const emptyPathDir = mkdtempSync(join(tmpdir(), "desktop-git-test-empty-path-"));
		directories.push(emptyPathDir);

		expect(() => resolveGitBinary(undefined, { PATH: emptyPathDir })).toThrowError(
			GitNotDetectedError,
		);
	});

	it("never probes the developer tools for an explicit gitPath or LOCAL_GIT_DIRECTORY", () => {
		const developerToolsMissing = vi.fn(() => true);

		expect(resolveGitBinary("/usr/bin/git", {}, developerToolsMissing)).toBe("/usr/bin/git");
		resolveGitBinary(undefined, { LOCAL_GIT_DIRECTORY: "/usr" }, developerToolsMissing);

		expect(developerToolsMissing).not.toHaveBeenCalled();
	});

	describe.skipIf(process.platform !== "darwin")("the macOS /usr/bin/git shim", () => {
		it("throws GitNotDetectedError when the Command Line Tools are missing", () => {
			expect(() => resolveGitBinary(undefined, { PATH: "/usr/bin" }, () => true)).toThrowError(
				GitNotDetectedError,
			);
		});

		it("resolves the shim when the Command Line Tools are installed", () => {
			expect(resolveGitBinary(undefined, { PATH: "/usr/bin" }, () => false)).toBe("/usr/bin/git");
		});
	});

	it("describes how to remedy a missing git executable", () => {
		const emptyPathDir = mkdtempSync(join(tmpdir(), "desktop-git-test-empty-path-"));
		directories.push(emptyPathDir);

		try {
			resolveGitBinary(undefined, { PATH: emptyPathDir });
			expect.unreachable();
		} catch (error) {
			expect((error as Error).name).toBe("GitNotDetectedError");
			expect((error as Error).message).toBe(
				"Git executable not found on PATH. Install git or pass gitPath to createGitClient().",
			);
		}
	});
});
