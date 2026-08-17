import { describe, expect, it } from "vitest";

import type { Workspace } from "../../contracts/workspaces/schemas.js";
import { resolveChatWorkspaceDirectory } from "./chat-workspace-directory.js";

const workspaces: Workspace[] = [
	{
		id: "draft-workspace",
		name: "Draft",
		folders: [
			{ id: "draft-extra", path: "/draft/extra", isPrimary: false, position: 1 },
			{ id: "draft-primary", path: "/draft/primary", isPrimary: true, position: 0 },
		],
		createdAt: 1,
		updatedAt: 1,
	},
	{
		id: "session-workspace",
		name: "Session",
		folders: [{ id: "session-primary", path: "/session/primary", isPrimary: true, position: 0 }],
		createdAt: 1,
		updatedAt: 1,
	},
];

describe("resolveChatWorkspaceDirectory", () => {
	it("uses the active workspace's primary folder for a draft chat", () => {
		expect(
			resolveChatWorkspaceDirectory({
				remoteId: undefined,
				activeWorkspaceId: "draft-workspace",
				sessionWorkspaceId: undefined,
				workspaces,
			}),
		).toBe("/draft/primary");
	});

	it("uses the persisted session workspace for an existing chat", () => {
		expect(
			resolveChatWorkspaceDirectory({
				remoteId: "session-1",
				activeWorkspaceId: "draft-workspace",
				sessionWorkspaceId: "session-workspace",
				workspaces,
			}),
		).toBe("/session/primary");
	});

	it("does not borrow the active draft workspace for an unscoped existing chat", () => {
		expect(
			resolveChatWorkspaceDirectory({
				remoteId: "session-1",
				activeWorkspaceId: "draft-workspace",
				sessionWorkspaceId: undefined,
				workspaces,
			}),
		).toBeUndefined();
	});
});
