import { describe, expect, it } from "vitest";

import {
	buildKiloDesktopSessionMetadata,
	hasKiloDesktopSessionMetadata,
	readWorkSessionIdFromMetadata,
	readWorkspaceFoldersFromMetadata,
	readWorkspaceIdFromMetadata,
	readWorktreeBranchFromMetadata,
} from "./kilo-metadata";

describe("Kilo Desktop chat metadata", () => {
	it("reads the workspace and worktree this app stamped on a chat", () => {
		const metadata = { "kilo-desktop": { workspaceId: "w1", worktree: { branch: "kilo/fix" } } };

		expect(hasKiloDesktopSessionMetadata(metadata)).toBe(true);
		expect(readWorkspaceIdFromMetadata(metadata)).toBe("w1");
		expect(readWorktreeBranchFromMetadata(metadata)).toBe("kilo/fix");
	});

	it("still reads the key used before the rename", () => {
		expect(readWorkspaceIdFromMetadata({ anaconda: { workspaceId: "w2" } })).toBe("w2");
	});

	it("leaves chats from other Kilo clients alone", () => {
		expect(hasKiloDesktopSessionMetadata({ other: {} })).toBe(false);
		expect(hasKiloDesktopSessionMetadata(undefined)).toBe(false);
		expect(readWorktreeBranchFromMetadata({ "kilo-desktop": { worktree: "x" } })).toBeUndefined();
	});

	it("stamps what it is given and reads it back", () => {
		const metadata = buildKiloDesktopSessionMetadata({
			workspaceId: "w1",
			workspaceFolders: [
				{ path: "/a", isPrimary: true },
				{ path: "/b", isPrimary: false },
			],
			worktreeBranch: "kilo/fix",
			workSessionId: "wses_1",
		});

		expect(metadata).toEqual({
			"kilo-desktop": {
				workspaceId: "w1",
				workspaceFolders: [
					{ path: "/a", isPrimary: true },
					{ path: "/b", isPrimary: false },
				],
				worktree: { branch: "kilo/fix" },
				workSessionId: "wses_1",
			},
		});
		expect(readWorkspaceFoldersFromMetadata(metadata)).toEqual([
			{ path: "/a", isPrimary: true },
			{ path: "/b", isPrimary: false },
		]);
		expect(readWorkSessionIdFromMetadata(metadata)).toBe("wses_1");
	});

	it("marks an unscoped chat as this app's with an empty stamp", () => {
		expect(buildKiloDesktopSessionMetadata({ workspaceFolders: [] })).toEqual({
			"kilo-desktop": {},
		});
	});

	it("skips malformed workspace folders", () => {
		expect(
			readWorkspaceFoldersFromMetadata({
				"kilo-desktop": {
					workspaceFolders: [{ path: "/a" }, "x", { path: "/b", isPrimary: true }],
				},
			}),
		).toEqual([{ path: "/b", isPrimary: true }]);
		expect(readWorkspaceFoldersFromMetadata({ "kilo-desktop": { workspaceFolders: "x" } })).toEqual(
			[],
		);
	});
});
