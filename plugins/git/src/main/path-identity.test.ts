import { describe, expect, it } from "vitest";

import { createPathIdentity, type Realpath } from "./path-identity.js";

/** A realpath over a fixed map of existing paths; anything else is ENOENT. */
function realpathOver(existing: Record<string, string>): Realpath {
	return async (target) => {
		const real = existing[target];
		if (real === undefined) {
			throw Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" });
		}
		return real;
	};
}

const SHORT_TEMP = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp";
const LONG_TEMP = "C:\\Users\\runneradmin\\AppData\\Local\\Temp";

describe("path identity on Windows", () => {
	const windows = createPathIdentity({
		platform: "win32",
		realpath: realpathOver({
			[`${SHORT_TEMP}\\repo`]: `${LONG_TEMP}\\repo`,
			[`${LONG_TEMP}\\repo`]: `${LONG_TEMP}\\repo`,
			[`${LONG_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`]: `${LONG_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`,
		}),
	});

	it("expands an 8.3 short name to the long path git reports", async () => {
		await expect(windows.canonical(`${SHORT_TEMP}\\repo`)).resolves.toBe(`${LONG_TEMP}\\repo`);
	});

	it("resolves the existing part of a path that does not exist yet and keeps the rest", async () => {
		await expect(windows.canonical(`${SHORT_TEMP}\\repo\\new\\file.ts`)).resolves.toBe(
			`${LONG_TEMP}\\repo\\new\\file.ts`,
		);
	});

	it("falls back to the normalized path when nothing of it exists", async () => {
		await expect(windows.canonical("D:\\gone\\..\\missing")).resolves.toBe("D:\\missing");
	});

	it("sees a worktree inside a folder whatever the separators or letter case", () => {
		const worktree = `${LONG_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`;
		expect(windows.within(`${LONG_TEMP}\\repo`, worktree)).toBe(true);
		expect(windows.within(`c:/users/RUNNERADMIN/appdata/local/temp/repo`, worktree)).toBe(true);
		expect(windows.within(`${LONG_TEMP}\\repo`, `${LONG_TEMP}\\repo`)).toBe(true);
		expect(windows.within(`${LONG_TEMP}\\repo`, `${LONG_TEMP}\\repo-other`)).toBe(false);
		expect(windows.within(`${LONG_TEMP}\\repo`, `D:\\repo`)).toBe(false);
	});

	it("compares paths for equality without regard to case or separators", () => {
		expect(
			windows.same(`${LONG_TEMP}\\Repo\\`, "c:/users/runneradmin/appdata/local/temp/repo"),
		).toBe(true);
		expect(windows.same(`${LONG_TEMP}\\repo`, `${LONG_TEMP}\\repo2`)).toBe(false);
	});
});

describe("path identity on macOS", () => {
	const mac = createPathIdentity({
		platform: "darwin",
		realpath: realpathOver({ "/var/folders/x/repo": "/private/var/folders/x/repo" }),
	});

	it("resolves symlinked folders like /var → /private/var", async () => {
		await expect(mac.canonical("/var/folders/x/repo")).resolves.toBe("/private/var/folders/x/repo");
	});

	it("ignores letter case, as the default APFS volume does", () => {
		expect(mac.within("/Users/Me/Project", "/users/me/project/src")).toBe(true);
		expect(mac.same("/Users/Me/Project", "/users/me/project")).toBe(true);
	});

	it("never treats a sibling with a shared prefix or a `..` escape as inside", () => {
		expect(mac.within("/work/project", "/work/project-other")).toBe(false);
		expect(mac.within("/work/project", "/work/project/../secrets")).toBe(false);
		expect(mac.within("/work/project", "/work/project/..foo")).toBe(true);
	});
});

describe("path identity on Linux", () => {
	const linux = createPathIdentity({ platform: "linux", realpath: realpathOver({}) });

	it("keeps letter case significant", () => {
		expect(linux.within("/home/me/Project", "/home/me/project/src")).toBe(false);
		expect(linux.same("/home/me/Project", "/home/me/project")).toBe(false);
		expect(linux.same("/home/me/project/", "/home/me/project")).toBe(true);
	});
});
