import { describe, expect, it } from "vitest";

import type { Workspace } from "../../../contracts/workspaces/schemas.js";
import { resolveSessionWorkspaceDirectory } from "./session-workspace-directory.js";

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

describe("resolveSessionWorkspaceDirectory", () => {
	it("uses the active workspace's primary folder for a draft session", () => {
		expect(
			resolveSessionWorkspaceDirectory({
				followsActiveWorkspace: true,
				activeWorkspaceId: "draft-workspace",
				sessionWorkspaceId: undefined,
				workspaces,
			}),
		).toBe("/draft/primary");
	});

	it("uses a started session's own workspace", () => {
		expect(
			resolveSessionWorkspaceDirectory({
				followsActiveWorkspace: false,
				activeWorkspaceId: "draft-workspace",
				sessionWorkspaceId: "session-workspace",
				workspaces,
			}),
		).toBe("/session/primary");
	});

	it("does not borrow the active workspace for a started session without one", () => {
		expect(
			resolveSessionWorkspaceDirectory({
				followsActiveWorkspace: false,
				activeWorkspaceId: "draft-workspace",
				sessionWorkspaceId: undefined,
				workspaces,
			}),
		).toBeUndefined();
	});
});
