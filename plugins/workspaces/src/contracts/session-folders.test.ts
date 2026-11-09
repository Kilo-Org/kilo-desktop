import { describe, expect, it } from "vitest";

import { resolvePathInFolders, sessionFolders } from "./session-folders";

const MULTI = [
	{ path: "/work/project", isPrimary: true },
	{ path: "/work/project/packages/lib", isPrimary: false },
	{ path: "/work/docs", isPrimary: false },
];
const WINDOWS = [{ path: "C:\\src\\app", isPrimary: true }];

describe("a session's folders", () => {
	it("are its workspace's, with its worktree in place of the primary folder", () => {
		expect(sessionFolders(MULTI, "/work/project")).toEqual(MULTI);
		expect(sessionFolders(MULTI, "/worktrees/feature")).toEqual([
			{ path: "/worktrees/feature", isPrimary: true },
			{ path: "/work/project/packages/lib", isPrimary: false },
			{ path: "/work/docs", isPrimary: false },
		]);
	});

	it("keep the worktree when the workspace is gone, and are none without either", () => {
		expect(sessionFolders([], "/worktrees/feature")).toEqual([
			{ path: "/worktrees/feature", isPrimary: true },
		]);
		expect(sessionFolders([], null)).toEqual([]);
	});
});

describe("resolving a path in a session's folders", () => {
	it("picks the deepest folder holding an absolute path", () => {
		expect(resolvePathInFolders(MULTI, "/work/project/src/index.ts")).toEqual({
			workspaceDirectory: "/work/project",
			relativePath: "src/index.ts",
		});
		expect(resolvePathInFolders(MULTI, "/work/project/packages/lib/src/a.ts")).toEqual({
			workspaceDirectory: "/work/project/packages/lib",
			relativePath: "src/a.ts",
		});
	});

	it("reads a relative path against the primary folder, and a folder as itself", () => {
		expect(resolvePathInFolders(MULTI, "./src/../README.md")).toEqual({
			workspaceDirectory: "/work/project",
			relativePath: "README.md",
		});
		expect(resolvePathInFolders(MULTI, "/work/docs/")).toEqual({
			workspaceDirectory: "/work/docs",
			relativePath: "",
		});
	});

	it("refuses paths outside the folders", () => {
		expect(resolvePathInFolders(MULTI, "/work/project-other/a.ts")).toBeNull();
		expect(resolvePathInFolders(MULTI, "/work/project/../secrets.txt")).toBeNull();
		expect(resolvePathInFolders(MULTI, "../outside.txt")).toBeNull();
		expect(resolvePathInFolders(MULTI, "/../../etc")).toBeNull();
		expect(resolvePathInFolders(MULTI, "  ")).toBeNull();
		expect(resolvePathInFolders([], "src/a.ts")).toBeNull();
	});

	it("matches Windows paths whatever the separators or drive-letter case", () => {
		const expected = { workspaceDirectory: "C:\\src\\app", relativePath: "lib/main.py" };
		expect(resolvePathInFolders(WINDOWS, "C:\\src\\app\\lib\\main.py")).toEqual(expected);
		expect(resolvePathInFolders(WINDOWS, "C:/src/app/lib/main.py")).toEqual(expected);
		expect(resolvePathInFolders(WINDOWS, "c:\\src\\app\\lib\\main.py")).toEqual(expected);
	});

	it("matches Windows paths in any letter case, keeping the path's own spelling", () => {
		expect(resolvePathInFolders(WINDOWS, "c:\\SRC\\App\\Lib\\Main.py")).toEqual({
			workspaceDirectory: "C:\\src\\app",
			relativePath: "Lib/Main.py",
		});
		expect(
			resolvePathInFolders([{ path: "C:\\Users\\Me\\Repo", isPrimary: true }], "c:/users/me/repo"),
		).toEqual({ workspaceDirectory: "C:\\Users\\Me\\Repo", relativePath: "" });
		expect(resolvePathInFolders(WINDOWS, "C:\\src\\application\\a.py")).toBeNull();
	});

	it("ignores letter case on POSIX paths only when the filesystem does", () => {
		const mixed = [{ path: "/Users/me/Project", isPrimary: true }];

		expect(resolvePathInFolders(mixed, "/users/ME/project/Src/a.ts", { ignoreCase: true })).toEqual(
			{ workspaceDirectory: "/Users/me/Project", relativePath: "Src/a.ts" },
		);
		expect(resolvePathInFolders(mixed, "/users/me/project/a.ts", { ignoreCase: false })).toBeNull();
		expect(resolvePathInFolders(mixed, "/Users/me/Project-other/a.ts", { ignoreCase: true })).toBe(
			null,
		);
	});
});
