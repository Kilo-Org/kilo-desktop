import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { webRegister } from "./index.js";

const FOLDERS = [
	{ path: "/work/project", isPrimary: true },
	{ path: "/work/docs", isPrimary: false },
];

/** Literal path table standing in for kilo-ui's resolver; resolution rules are tested in kilo-ui. */
const RESOLVED: Record<string, { workspaceDirectory: string; relativePath: string }> = {
	"/work/project/src/app.ts": { workspaceDirectory: "/work/project", relativePath: "src/app.ts" },
	"/work/docs/guide.md": { workspaceDirectory: "/work/docs", relativePath: "guide.md" },
	"/work/docs": { workspaceDirectory: "/work/docs", relativePath: "" },
};

type Tab = {
	instanceId: string;
	definitionId: string;
	metadata?: Readonly<Record<string, string>>;
};

function makeSystem(
	options: { tabs?: Tab[]; withKiloUi?: boolean; sessionOfChat?: Record<string, string> } = {},
) {
	const gitSdk = createFakeSdk({ featureId: "git" });
	const system = createFakeFeatureSystem({ sdks: { git: gitSdk } });
	const panel = {
		listTabs: vi.fn((): readonly Tab[] => options.tabs ?? []),
		activateTab: vi.fn(),
		openContributedTab: vi.fn(() => ({ instanceId: "changes-new", title: "Changes 1" })),
		updateTab: vi.fn(),
	};
	if (options.withKiloUi !== false) {
		const kiloUi = system.getSdk("kilo-ui");
		kiloUi.plugins.expose("chatRightPanel", panel);
		// By default each fixture chat's session shares its id, to keep assertions readable.
		const sessionOfChat = options.sessionOfChat;
		kiloUi.plugins.expose("sessions", {
			sessionIdOfChat: (kiloSessionId: string) =>
				sessionOfChat ? sessionOfChat[kiloSessionId] : kiloSessionId,
		});
		kiloUi.plugins.expose("chatSessionWorkspace", {
			getFolders: (sessionId: string) => (sessionId === "chat-1" ? FOLDERS : []),
			resolvePath: (sessionId: string, path: string) =>
				sessionId === "chat-1" ? (RESOLVED[path] ?? null) : null,
		});
	}
	webRegister(gitSdk);
	const openChanges = (args: Record<string, unknown>, kiloSessionId: string | null = "chat-1") =>
		system.services.toolRegistry.invoke(
			"git",
			"changes_open",
			args,
			kiloSessionId ? { kiloSessionId } : {},
		);
	return { system, panel, openChanges };
}

describe("git_changes_open WebMCP tool", () => {
	it("is exposed to the model", () => {
		const { system } = makeSystem();

		const tool = system.services.toolRegistry
			.all()
			.find((entry) => entry.id === "git.changes_open");
		expect(tool?.exposeToModelContext).toBe(true);
		expect(tool?.annotations?.idempotentHint).toBe(true);
	});

	it("opens the Changes tab in the calling chat", async () => {
		const { panel, openChanges } = makeSystem();

		await expect(openChanges({})).resolves.toEqual({
			sessionId: "chat-1",
			instanceId: "changes-new",
		});
		expect(panel.openContributedTab).toHaveBeenCalledWith(
			"chat-1",
			{ id: "git.changes", title: "Changes" },
			undefined,
		);
	});

	it("opens the Changes tab in the calling chat's work session", async () => {
		const { panel, openChanges } = makeSystem({ sessionOfChat: { ses_1: "chat-1" } });

		await expect(openChanges({}, "ses_1")).resolves.toEqual({
			sessionId: "chat-1",
			instanceId: "changes-new",
		});
		expect(panel.openContributedTab).toHaveBeenCalledWith(
			"chat-1",
			{ id: "git.changes", title: "Changes" },
			undefined,
		);
	});

	it("refuses a chat that no work session owns", async () => {
		const { panel, openChanges } = makeSystem({ sessionOfChat: {} });

		await expect(openChanges({}, "ses_subagent")).resolves.toMatchObject({
			error: expect.any(String),
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("focuses an open Changes tab without resetting its folder or selection", async () => {
		const { panel, openChanges } = makeSystem({
			tabs: [
				{
					instanceId: "changes-1",
					definitionId: "git.changes",
					metadata: {
						workspaceDirectory: "/work/docs",
						revealPath: "guide.md",
						revealRequest: "1",
					},
				},
			],
		});

		await expect(openChanges({})).resolves.toEqual({
			sessionId: "chat-1",
			instanceId: "changes-1",
		});
		expect(panel.updateTab).not.toHaveBeenCalled();
		expect(panel.activateTab).toHaveBeenCalledWith("chat-1", "changes-1");
	});

	it("opens the Changes tab on a changed file in its workspace folder", async () => {
		const { panel, openChanges } = makeSystem();

		await expect(openChanges({ path: "/work/docs/guide.md" })).resolves.toEqual({
			sessionId: "chat-1",
			instanceId: "changes-new",
			workspaceDirectory: "/work/docs",
			relativePath: "guide.md",
		});
		expect(panel.openContributedTab).toHaveBeenCalledWith(
			"chat-1",
			{ id: "git.changes", title: "Changes" },
			{
				metadata: {
					workspaceDirectory: "/work/docs",
					revealPath: "guide.md",
					revealRequest: expect.any(String),
				},
			},
		);
	});

	it("opens a workspace folder's changes when given the folder itself", async () => {
		const { panel, openChanges } = makeSystem();

		await openChanges({ path: "/work/docs" });

		expect(panel.openContributedTab).toHaveBeenCalledWith("chat-1", expect.anything(), {
			metadata: { workspaceDirectory: "/work/docs", revealRequest: expect.any(String) },
		});
	});

	it("reuses an open Changes tab and issues a fresh reveal request", async () => {
		const { panel, openChanges } = makeSystem({
			tabs: [
				{ instanceId: "files-1", definitionId: "files.files" },
				{
					instanceId: "changes-1",
					definitionId: "git.changes",
					metadata: { revealPath: "old.ts", revealRequest: "old" },
				},
			],
		});

		await expect(openChanges({ path: "/work/project/src/app.ts" })).resolves.toMatchObject({
			instanceId: "changes-1",
			relativePath: "src/app.ts",
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
		expect(panel.updateTab).toHaveBeenCalledWith("chat-1", "changes-1", {
			metadata: {
				workspaceDirectory: "/work/project",
				revealPath: "src/app.ts",
				revealRequest: expect.not.stringMatching(/^old$/),
			},
		});
		expect(panel.activateTab).toHaveBeenCalledWith("chat-1", "changes-1");
	});

	it("refuses paths outside the chat's workspace folders", async () => {
		const { panel, openChanges } = makeSystem();

		await expect(openChanges({ path: "/etc/hosts" })).resolves.toEqual({
			error: expect.stringMatching(/outside this chat's workspace folders.*\/work\/project/),
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("explains when the chat has no workspace folders", async () => {
		const { panel, openChanges } = makeSystem();

		await expect(openChanges({}, "unscoped-chat")).resolves.toEqual({
			error: expect.stringContaining("no workspace folders"),
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("requires an originating Kilo chat session", async () => {
		const { openChanges } = makeSystem();

		await expect(openChanges({}, null)).resolves.toEqual({
			error: expect.stringContaining("originating Kilo chat session"),
		});
	});

	it("reports when the chat UI is unavailable", async () => {
		const { openChanges } = makeSystem({ withKiloUi: false });

		await expect(openChanges({})).resolves.toEqual({
			error: expect.stringContaining("unavailable"),
		});
	});
});
