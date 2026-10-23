import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { filesContract } from "../../../contracts/schemas.js";
import { webRegister } from "../../index.js";

const FOLDERS = [
	{ path: "/work/project", isPrimary: true },
	{ path: "/work/docs", isPrimary: false },
];

/** Literal path table standing in for kilo-ui's resolver; resolution rules are tested in kilo-ui. */
const RESOLVED: Record<string, { workspaceDirectory: string; relativePath: string }> = {
	"/work/project/src/app.ts": { workspaceDirectory: "/work/project", relativePath: "src/app.ts" },
	"/work/project": { workspaceDirectory: "/work/project", relativePath: "" },
	"notes/missing.md": { workspaceDirectory: "/work/project", relativePath: "notes/missing.md" },
};

function makeSystem(
	options: {
		existing?: readonly string[];
		withKiloUi?: boolean;
		existenceCheckFails?: boolean;
	} = {},
) {
	const existing = new Set(options.existing ?? ["src/app.ts"]);
	const filesSdk = createFakeSdk({
		featureId: "files",
		channels: filesContract,
		handlers: {
			existingPaths: async ({ relativePaths }: { relativePaths: string[] }) => {
				if (options.existenceCheckFails) throw new Error("Workspace directory is invalid.");
				return { paths: relativePaths.filter((relativePath) => existing.has(relativePath)) };
			},
		},
	});
	const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
	const panel = {
		listTabs: vi.fn(() => []),
		getActiveTabId: vi.fn(() => null),
		activateTab: vi.fn(),
		openContributedTab: vi.fn(),
		updateTab: vi.fn(),
		registerTabLifecycle: vi.fn(() => () => {}),
	};
	if (options.withKiloUi !== false) {
		const kiloUi = system.getSdk("kilo-ui");
		kiloUi.plugins.expose("chatRightPanel", panel);
		// Each fixture chat's session shares its id, to keep assertions readable.
		kiloUi.plugins.expose("sessions", {
			sessionIdOfChat: (kiloSessionId: string) => kiloSessionId,
		});
		kiloUi.plugins.expose("chatSessionWorkspace", {
			getFolders: (sessionId: string) => (sessionId === "chat-1" ? FOLDERS : []),
			resolvePath: (sessionId: string, path: string) =>
				sessionId === "chat-1" ? (RESOLVED[path] ?? null) : null,
		});
	}
	webRegister(filesSdk);
	const openFile = (args: Record<string, unknown>, kiloSessionId: string | null = "chat-1") =>
		system.services.toolRegistry.invoke(
			"files",
			"open",
			args,
			kiloSessionId ? { kiloSessionId } : {},
		);
	return { system, panel, openFile };
}

describe("files_open WebMCP tool", () => {
	it("is exposed to the model", () => {
		const { system } = makeSystem();

		const tool = system.services.toolRegistry.all().find((entry) => entry.id === "files.open");
		expect(tool?.exposeToModelContext).toBe(true);
		expect(tool?.description).toMatch(/workspace folders/i);
	});

	it("opens a workspace file at a line in the calling chat's pane layout", async () => {
		const { panel, openFile } = makeSystem();

		await expect(
			openFile({ path: "/work/project/src/app.ts", line: 42, column: 3 }),
		).resolves.toEqual({
			sessionId: "chat-1",
			workspaceDirectory: "/work/project",
			relativePath: "src/app.ts",
			line: 42,
			column: 3,
		});
		expect(panel.openContributedTab).toHaveBeenCalledWith(
			"chat-1",
			{ id: "files.files", title: "Files" },
			expect.objectContaining({
				title: "app.ts",
				metadata: expect.objectContaining({
					workspaceDirectory: "/work/project",
					relativePath: "src/app.ts",
					line: "42",
					column: "3",
				}),
			}),
		);
	});

	it("refuses paths outside the chat's workspace folders", async () => {
		const { panel, openFile } = makeSystem();

		await expect(openFile({ path: "/etc/passwd" })).resolves.toEqual({
			error: expect.stringMatching(
				/outside this chat's workspace folders.*\/work\/project.*\/work\/docs/,
			),
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("reports files that do not exist instead of opening an empty pane", async () => {
		const { panel, openFile } = makeSystem();

		await expect(openFile({ path: "notes/missing.md" })).resolves.toEqual({
			error: expect.stringContaining("not found"),
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("reports a failed existence check as a tool error", async () => {
		const { panel, openFile } = makeSystem({ existenceCheckFails: true });

		await expect(openFile({ path: "/work/project/src/app.ts" })).resolves.toEqual({
			error: expect.stringContaining("Workspace directory is invalid."),
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("refuses a folder, which is not a file", async () => {
		const { openFile } = makeSystem();

		await expect(openFile({ path: "/work/project" })).resolves.toEqual({
			error: expect.stringContaining("not a file"),
		});
	});

	it("explains when the chat has no workspace folders", async () => {
		const { openFile } = makeSystem();

		await expect(openFile({ path: "/work/project/src/app.ts" }, "unscoped-chat")).resolves.toEqual({
			error: expect.stringContaining("no workspace folders"),
		});
	});

	it("requires an originating Kilo chat session", async () => {
		const { panel, openFile } = makeSystem();

		await expect(openFile({ path: "/work/project/src/app.ts" }, null)).resolves.toEqual({
			error: expect.stringContaining("originating Kilo chat session"),
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("reports when the chat UI is unavailable", async () => {
		const { openFile } = makeSystem({ withKiloUi: false });

		await expect(openFile({ path: "/work/project/src/app.ts" })).resolves.toEqual({
			error: expect.stringContaining("unavailable"),
		});
	});

	it("rejects non-positive line numbers", async () => {
		const { openFile } = makeSystem();

		await expect(openFile({ path: "/work/project/src/app.ts", line: 0 })).rejects.toThrow();
	});
});
