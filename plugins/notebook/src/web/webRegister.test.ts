import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { notebookContract } from "../contracts/schemas.js";
import { webRegister, type NotebookCapabilities } from "./index.js";
import {
	listOpenNotebooks,
	openNotebookFileInPanel,
	openNotebookInPanel,
	NOTEBOOK_TAB_DEFINITION_ID,
	NOTEBOOK_TAB_TITLE,
	type ChatRightPanelCapability,
} from "./notebook/notebook-webmcp-tools.js";
import type { ChatRightPanelTabSnapshot } from "./notebook/notebook-tabs.js";

/**
 * In-memory stand-in for kilo-ui's chatRightPanel capability. Production
 * notebook code asserts the shape via `sdk.plugins.get` and never imports
 * kilo-ui source — tests follow the same boundary.
 */
function createFakeChatRightPanel(): ChatRightPanelCapability & {
	setFocusedSessionId(sessionId: string | null): void;
} {
	let focusedSessionId: string | null = null;
	const tabsBySession = new Map<string, ChatRightPanelTabSnapshot[]>();
	const activeBySession = new Map<string, string>();
	let ordinal = 0;

	return {
		getFocusedSessionId: () => focusedSessionId,
		setFocusedSessionId: (sessionId) => {
			focusedSessionId = sessionId;
		},
		listTabs: (sessionId) => tabsBySession.get(sessionId) ?? [],
		getActiveTabId: (sessionId) => activeBySession.get(sessionId) ?? null,
		show: () => undefined,
		openContributedTab: (sessionId, definition, options) => {
			const existing = options?.instanceId
				? tabsBySession.get(sessionId)?.find((entry) => entry.instanceId === options.instanceId)
				: undefined;
			if (existing) {
				activeBySession.set(sessionId, existing.instanceId);
				return existing;
			}
			ordinal += 1;
			const instanceId = options?.instanceId ?? `nb-${String(ordinal)}`;
			const title = options?.title ?? `${definition.title} ${String(ordinal)}`;
			const tab: ChatRightPanelTabSnapshot = {
				instanceId,
				definitionId: definition.id,
				title,
				...(options?.metadata ? { metadata: options.metadata } : {}),
			};
			tabsBySession.set(sessionId, [...(tabsBySession.get(sessionId) ?? []), tab]);
			activeBySession.set(sessionId, instanceId);
			return { instanceId, title };
		},
	};
}

function makeSystem(
	panel: ReturnType<typeof createFakeChatRightPanel> = createFakeChatRightPanel(),
) {
	const notebookSdk = createFakeSdk({
		featureId: "notebook",
		channels: notebookContract,
		handlers: {
			status: async () => ({
				availability: { status: "available" as const },
				process: { status: "external" as const },
				daemon: {
					version: "2.6.3",
					socketPath: "/tmp/runtimed.sock",
					isDevMode: false,
					blobPort: null,
				},
			}),
			openFile: async ({ path }: { path: string }) => ({
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				path,
				title: "analysis.ipynb",
			}),
			save: async () => ({ outcome: "saved" as const }),
			setDefaultSaveDirectory: async () => undefined,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { notebook: notebookSdk } });
	system.getSdk("kilo-ui").plugins.expose("chatRightPanel", panel);
	return { system, notebookSdk, panel };
}

describe("notebook plugin webRegister", () => {
	it("registers notebook panel tools with external exposure opted in", () => {
		const { system, notebookSdk } = makeSystem();
		webRegister(notebookSdk);

		const tools = system.services.toolRegistry.all();
		expect(tools.map((tool) => tool.id).sort()).toEqual([
			"notebook.list_open",
			"notebook.open",
			"notebook.open_file",
		]);
		expect(tools.every((tool) => tool.exposeToModelContext)).toBe(true);
		expect(tools.find((tool) => tool.name === "list_open")?.annotations?.readOnlyHint).toBe(true);
	});

	it("tells the model to open notebooks only in the chat side panel", () => {
		const { system, notebookSdk } = makeSystem();
		webRegister(notebookSdk);

		const descriptions = system.services.toolRegistry
			.all()
			.map((tool) => tool.description)
			.join("\n");

		expect(descriptions).toMatch(/chat right-hand side panel/i);
		expect(descriptions).toContain("notebooks_create_notebook");
		expect(descriptions).toContain("notebooks_show_notebook");
		expect(descriptions).toMatch(/external nteract/i);
		expect(descriptions).toMatch(/never/i);
	});

	it("list_open returns notebooks for the focused session", async () => {
		const { system, notebookSdk, panel } = makeSystem();
		webRegister(notebookSdk);
		panel.setFocusedSessionId("chat-1");
		panel.openContributedTab("chat-1", {
			id: NOTEBOOK_TAB_DEFINITION_ID,
			title: NOTEBOOK_TAB_TITLE,
		});

		const result = await system.services.toolRegistry.invoke("notebook", "list_open", {});
		expect(result).toEqual({
			sessionId: "chat-1",
			notebooks: [
				{
					notebook_id: "nb-1",
					title: "Notebook 1",
					active: true,
				},
			],
		});
	});

	it("open creates a notebook tab and returns notebook_id", async () => {
		const { system, notebookSdk, panel } = makeSystem();
		webRegister(notebookSdk);
		panel.setFocusedSessionId("chat-1");

		const result = await system.services.toolRegistry.invoke("notebook", "open", {});
		expect(result).toEqual({
			sessionId: "chat-1",
			notebook_id: "nb-1",
			title: "Notebook 1",
		});
		expect(panel.listTabs("chat-1")).toHaveLength(1);
	});

	it("open_file opens an ipynb path with its daemon identity and restorable metadata", async () => {
		const { system, notebookSdk, panel } = makeSystem();
		webRegister(notebookSdk);
		panel.setFocusedSessionId("chat-1");

		const result = await system.services.toolRegistry.invoke("notebook", "open_file", {
			path: "/projects/analysis.ipynb",
		});

		expect(result).toEqual({
			sessionId: "chat-1",
			notebook_id: "669d39ec-39d6-4160-815c-b46e170cde8d",
			title: "analysis.ipynb",
			path: "/projects/analysis.ipynb",
		});
		expect(panel.listTabs("chat-1")).toEqual([
			expect.objectContaining({
				instanceId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				title: "analysis.ipynb",
				metadata: { notebookPath: "/projects/analysis.ipynb" },
			}),
		]);
	});

	it("exposes a notebook viewer capability that opens a file in the requested chat", async () => {
		const { system, notebookSdk, panel } = makeSystem();
		webRegister(notebookSdk);
		panel.setFocusedSessionId("another-chat");

		const notebookViewer = system
			.getSdk("files")
			.plugins.get<NotebookCapabilities>("notebook")?.notebookViewer;

		await expect(
			notebookViewer?.openFile({
				sessionId: "chat-1",
				path: "/projects/analysis.ipynb",
			}),
		).resolves.toEqual({
			sessionId: "chat-1",
			notebook_id: "669d39ec-39d6-4160-815c-b46e170cde8d",
			title: "analysis.ipynb",
			path: "/projects/analysis.ipynb",
		});
		expect(panel.listTabs("chat-1")).toEqual([
			expect.objectContaining({
				instanceId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				title: "analysis.ipynb",
				metadata: { notebookPath: "/projects/analysis.ipynb" },
			}),
		]);
		expect(panel.listTabs("another-chat")).toEqual([]);
	});

	it("normalizes legacy notebook instance ids inside the notebook plugin", () => {
		const { notebookSdk, panel } = makeSystem();
		panel.setFocusedSessionId("chat-1");
		const legacyId = `${NOTEBOOK_TAB_DEFINITION_ID}:legacy-uuid`;
		const originalListTabs = panel.listTabs;
		panel.listTabs = () => [
			{ instanceId: legacyId, definitionId: NOTEBOOK_TAB_DEFINITION_ID, title: "Notebook 1" },
		];
		panel.getActiveTabId = () => legacyId;

		expect(listOpenNotebooks(notebookSdk)).toEqual({
			sessionId: "chat-1",
			notebooks: [{ notebook_id: "legacy-uuid", title: "Notebook 1", active: true }],
		});
		panel.listTabs = originalListTabs;
	});

	it("returns a structured error when no chat is focused", () => {
		const { notebookSdk } = makeSystem();
		expect(listOpenNotebooks(notebookSdk)).toMatchObject({
			sessionId: null,
			notebooks: [],
			error: expect.stringContaining("focused chat"),
		});
		expect(openNotebookInPanel(notebookSdk)).toMatchObject({
			error: expect.stringContaining("focused chat"),
		});
	});

	it("returns a structured error when kilo-ui is unavailable", () => {
		const notebookSdk = createFakeSdk({ featureId: "notebook" });
		expect(listOpenNotebooks(notebookSdk)).toMatchObject({
			error: expect.stringContaining("unavailable"),
		});
		expect(openNotebookInPanel(notebookSdk)).toMatchObject({
			error: expect.stringContaining("unavailable"),
		});
	});

	it("does not ask the main process to open a file without a focused chat", async () => {
		const { notebookSdk } = makeSystem();
		const invoke = vi.spyOn(notebookSdk, "invoke");

		await expect(openNotebookFileInPanel(notebookSdk, "/projects/analysis.ipynb")).resolves.toEqual(
			{
				error: expect.stringContaining("focused chat"),
			},
		);
		expect(invoke).not.toHaveBeenCalled();
	});

	it("returns a structured error when kilo-ui is unavailable for open_file", async () => {
		const notebookSdk = createFakeSdk({ featureId: "notebook" });
		await expect(openNotebookFileInPanel(notebookSdk, "/projects/analysis.ipynb")).resolves.toEqual(
			{
				error: expect.stringContaining("unavailable"),
			},
		);
	});

	it("returns the invoke error when opening a notebook file fails", async () => {
		const { notebookSdk, panel } = makeSystem();
		panel.setFocusedSessionId("chat-1");
		vi.spyOn(notebookSdk, "invoke").mockRejectedValueOnce(new Error("not an ipynb"));

		await expect(openNotebookFileInPanel(notebookSdk, "/projects/notes.txt")).resolves.toEqual({
			error: "not an ipynb",
		});
	});

	it("falls back when opening a notebook file fails with a non-Error", async () => {
		const { notebookSdk, panel } = makeSystem();
		panel.setFocusedSessionId("chat-1");
		vi.spyOn(notebookSdk, "invoke").mockRejectedValueOnce("denied");

		await expect(openNotebookFileInPanel(notebookSdk, "/projects/analysis.ipynb")).resolves.toEqual(
			{
				error: "The notebook file could not be opened.",
			},
		);
	});
});
