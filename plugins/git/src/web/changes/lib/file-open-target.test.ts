import { describe, expect, it } from "vitest";

import type { WorkSessionFolder } from "@kilo-desktop/plugin-work-sessions/contracts";

import { fileOpenTarget } from "./file-open-target";

const primary = (path: string): WorkSessionFolder[] => [{ path, isPrimary: true }];

describe("fileOpenTarget", () => {
	it("joins a repository path onto a folder at the repository's top level", () => {
		expect(fileOpenTarget("src/a.ts", "/repo", primary("/repo"))).toBe("/repo/src/a.ts");
	});

	it("opens a file inside a folder below the repository's top level", () => {
		expect(fileOpenTarget("project/src/a.ts", "/ws", primary("/ws/project"))).toBe(
			"/ws/project/src/a.ts",
		);
	});

	it("offers nothing for a file outside the session's folders", () => {
		expect(fileOpenTarget("other/b.ts", "/ws", primary("/ws/project"))).toBeNull();
	});

	it("offers nothing for a path that is the folder itself", () => {
		expect(fileOpenTarget("project", "/ws", primary("/ws/project"))).toBeNull();
	});

	it("uses backslashes for a Windows folder", () => {
		expect(fileOpenTarget("src/a.ts", "C:\\repo", primary("C:\\repo"))).toBe("C:\\repo\\src\\a.ts");
	});

	it("opens a file inside a Windows folder below the repository's top level", () => {
		expect(fileOpenTarget("pkg/src/a.ts", "C:\\repo", primary("C:\\repo\\pkg"))).toBe(
			"C:\\repo\\pkg\\src\\a.ts",
		);
	});

	it("doesn't double the separator after a folder's trailing backslash", () => {
		expect(fileOpenTarget("src/a.ts", "C:\\repo", primary("C:\\repo\\"))).toBe(
			"C:\\repo\\src\\a.ts",
		);
	});

	it("keeps the folder's spelling, not the repository top level's", () => {
		expect(fileOpenTarget("pkg/src/a.ts", "c:\\repo", primary("C:\\Repo\\pkg"))).toBe(
			"C:\\Repo\\pkg\\src\\a.ts",
		);
	});
});
