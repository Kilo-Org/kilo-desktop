import { describe, expect, it } from "vitest";

import type { Workspace } from "../../../contracts/workspaces/schemas.js";
import type { SessionActivity } from "../activity/session-activity-logic.js";
import { createChatSessionWorkspaceCapability } from "./chat-session-workspace-capability.js";

const workspaces: Workspace[] = [
	{
		id: "multi",
		name: "Multi",
		folders: [
			{ id: "primary", path: "/work/project", isPrimary: true, position: 0 },
			{ id: "nested", path: "/work/project/packages/lib", isPrimary: false, position: 1 },
			{ id: "docs", path: "/work/docs", isPrimary: false, position: 2 },
		],
		createdAt: 1,
		updatedAt: 1,
	},
	{
		id: "windows",
		name: "Windows",
		folders: [{ id: "win", path: "C:\\src\\app", isPrimary: true, position: 0 }],
		createdAt: 1,
		updatedAt: 1,
	},
];

function activity(patch: Partial<SessionActivity>): SessionActivity {
	return { pendingPermissionIds: [], pendingQuestionIds: [], ...patch };
}

function capabilityFor(
	chats: Record<string, SessionActivity>,
	chatOfSession: Record<string, string> = Object.fromEntries(
		Object.keys(chats).map((chatId) => [chatId, chatId]),
	),
) {
	return createChatSessionWorkspaceCapability({
		getChatOfSession: (sessionId) => chatOfSession[sessionId],
		getChatActivity: (chatId) => chats[chatId],
		getWorkspaces: () => workspaces,
	});
}

describe("chatSessionWorkspace capability", () => {
	it("lists the folders of the session's workspace", () => {
		const capability = capabilityFor({ "chat-1": activity({ workspaceId: "multi" }) });

		expect(capability.getFolders("chat-1")).toEqual([
			{ path: "/work/project", isPrimary: true },
			{ path: "/work/project/packages/lib", isPrimary: false },
			{ path: "/work/docs", isPrimary: false },
		]);
	});

	it("reads a session's folders through its chat", () => {
		const capability = capabilityFor(
			{ ses_1: activity({ workspaceId: "windows" }) },
			{ wses_a: "ses_1" },
		);

		expect(capability.getFolders("wses_a")).toEqual([{ path: "C:\\src\\app", isPrimary: true }]);
		expect(capability.getFolders("ses_1")).toEqual([]);
	});

	it("puts a worktree session's worktree in place of the primary folder", () => {
		const capability = capabilityFor({
			"chat-1": activity({
				workspaceId: "multi",
				worktreeBranch: "kilo/feature",
				directory: "/worktrees/feature",
			}),
		});

		expect(capability.getFolders("chat-1")).toEqual([
			{ path: "/worktrees/feature", isPrimary: true },
			{ path: "/work/project/packages/lib", isPrimary: false },
			{ path: "/work/docs", isPrimary: false },
		]);
	});

	it("keeps a worktree session's worktree even when its workspace is gone", () => {
		const capability = capabilityFor({
			"chat-1": activity({
				workspaceId: "deleted",
				worktreeBranch: "kilo/feature",
				directory: "/worktrees/feature",
			}),
		});

		expect(capability.getFolders("chat-1")).toEqual([
			{ path: "/worktrees/feature", isPrimary: true },
		]);
	});

	it("has no folders for unknown or unscoped sessions", () => {
		const capability = capabilityFor({ unscoped: activity({ directory: "/tmp/unscoped" }) });

		expect(capability.getFolders("missing")).toEqual([]);
		expect(capability.getFolders("unscoped")).toEqual([]);
	});

	it("resolves an absolute path to the deepest containing folder", () => {
		const capability = capabilityFor({ "chat-1": activity({ workspaceId: "multi" }) });

		expect(capability.resolvePath("chat-1", "/work/project/src/index.ts")).toEqual({
			workspaceDirectory: "/work/project",
			relativePath: "src/index.ts",
		});
		expect(capability.resolvePath("chat-1", "/work/project/packages/lib/src/a.ts")).toEqual({
			workspaceDirectory: "/work/project/packages/lib",
			relativePath: "src/a.ts",
		});
	});

	it("resolves a relative path against the primary folder", () => {
		const capability = capabilityFor({ "chat-1": activity({ workspaceId: "multi" }) });

		expect(capability.resolvePath("chat-1", "./src/../README.md")).toEqual({
			workspaceDirectory: "/work/project",
			relativePath: "README.md",
		});
	});

	it("resolves a folder itself to an empty relative path", () => {
		const capability = capabilityFor({ "chat-1": activity({ workspaceId: "multi" }) });

		expect(capability.resolvePath("chat-1", "/work/docs/")).toEqual({
			workspaceDirectory: "/work/docs",
			relativePath: "",
		});
	});

	it("refuses paths outside the session's folders", () => {
		const capability = capabilityFor({ "chat-1": activity({ workspaceId: "multi" }) });

		expect(capability.resolvePath("chat-1", "/work/project-other/a.ts")).toBeNull();
		expect(capability.resolvePath("chat-1", "/work/project/../secrets.txt")).toBeNull();
		expect(capability.resolvePath("chat-1", "../outside.txt")).toBeNull();
		expect(capability.resolvePath("missing", "/work/project/a.ts")).toBeNull();
	});

	it("matches Windows paths regardless of separator style or drive-letter case", () => {
		const capability = capabilityFor({ "chat-1": activity({ workspaceId: "windows" }) });

		expect(capability.resolvePath("chat-1", "C:\\src\\app\\lib\\main.py")).toEqual({
			workspaceDirectory: "C:\\src\\app",
			relativePath: "lib/main.py",
		});
		expect(capability.resolvePath("chat-1", "C:/src/app/lib/main.py")).toEqual({
			workspaceDirectory: "C:\\src\\app",
			relativePath: "lib/main.py",
		});
		expect(capability.resolvePath("chat-1", "c:\\src\\app\\lib\\main.py")).toEqual({
			workspaceDirectory: "C:\\src\\app",
			relativePath: "lib/main.py",
		});
	});
});
