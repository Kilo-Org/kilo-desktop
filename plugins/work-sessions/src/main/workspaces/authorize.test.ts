import { describe, expect, it } from "vitest";

import type { Workspace } from "../../contracts/model";
import { authorizePath, type PathEnvironment } from "./authorize";

const SHORT_TEMP = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp";
const LONG_TEMP = "C:\\Users\\runneradmin\\AppData\\Local\\Temp";

function workspaceWith(folderPath: string): Workspace {
	return {
		id: "w1",
		name: "App",
		folders: [{ id: "f1", path: folderPath, isPrimary: true, position: 0 }],
		createdAt: 0,
		updatedAt: 0,
	};
}

/**
 * Windows where `LONG_TEMP\repo` (and its managed worktree) exist and the
 * short temp name expands to the long one, as the native realpath does.
 */
const windows: PathEnvironment = {
	platform: "win32",
	realpath: async (target) => {
		const long = target.startsWith(`${SHORT_TEMP}\\`)
			? LONG_TEMP + target.slice(SHORT_TEMP.length)
			: target;
		const existing = [`${LONG_TEMP}\\repo`, `${LONG_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`];
		const real = existing.find((candidate) => candidate.toLowerCase() === long.toLowerCase());
		if (real === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		return real;
	},
};

const WORKTREE = `${LONG_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`;

describe("authorizing paths across spellings of a folder", () => {
	it("allows a worktree git reports in long form inside a folder stored by its short name", async () => {
		const workspaces = [workspaceWith(`${SHORT_TEMP}\\repo`)];

		await expect(authorizePath(workspaces, WORKTREE, "inside", windows)).resolves.toEqual({
			allowed: true,
			workspaceId: "w1",
			folder: `${SHORT_TEMP}\\repo`,
			path: WORKTREE,
		});
		await expect(authorizePath(workspaces, WORKTREE, "folder", windows)).resolves.toMatchObject({
			allowed: true,
		});
	});

	it("allows a path given by its short name or in other letter case", async () => {
		const workspaces = [workspaceWith(`${LONG_TEMP}\\repo`)];

		for (const target of [
			`${SHORT_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`,
			`${SHORT_TEMP}\\repo\\src\\new-file.ts`,
			"c:/users/RUNNERADMIN/appdata/local/temp/REPO/src/new-file.ts",
		]) {
			await expect(authorizePath(workspaces, target, "inside", windows)).resolves.toMatchObject({
				allowed: true,
			});
		}
	});

	it("still refuses siblings and escapes", async () => {
		const workspaces = [workspaceWith(`${SHORT_TEMP}\\repo`)];

		for (const target of [
			`${LONG_TEMP}\\repo-other`,
			`${LONG_TEMP}\\repo\\..\\secrets.txt`,
			"D:\\repo",
		]) {
			await expect(authorizePath(workspaces, target, "inside", windows)).resolves.toEqual({
				allowed: false,
			});
		}
	});

	it("ignores letter case on macOS, where the default volume does", async () => {
		const mac: PathEnvironment = {
			platform: "darwin",
			realpath: async () => {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			},
		};
		const workspaces = [workspaceWith("/Users/me/Project")];

		await expect(
			authorizePath(workspaces, "/users/ME/project/src/a.ts", "inside", mac),
		).resolves.toMatchObject({ allowed: true });
		await expect(
			authorizePath(workspaces, "/users/me/project/.kilo/worktrees/kilo-otter", "folder", mac),
		).resolves.toMatchObject({ allowed: true });
	});

	it("keeps letter case significant on Linux", async () => {
		const linux: PathEnvironment = {
			platform: "linux",
			realpath: async () => {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			},
		};
		const workspaces = [workspaceWith("/home/me/Project")];

		await expect(
			authorizePath(workspaces, "/home/me/project/src/a.ts", "inside", linux),
		).resolves.toEqual({ allowed: false });
	});
});
