import { describe, expect, it } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { webRegister } from "./index.js";
import {
	listOpenNotebooks,
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
		openContributedTab: (sessionId, definition) => {
			ordinal += 1;
			const instanceId = `nb-${String(ordinal)}`;
			const title = `${definition.title} ${String(ordinal)}`;
			const tab: ChatRightPanelTabSnapshot = {
				instanceId,
				definitionId: definition.id,
				title,
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
	const notebookSdk = createFakeSdk({ featureId: "notebook" });
	const system = createFakeFeatureSystem({ sdks: { notebook: notebookSdk } });
	system.getSdk("kilo-ui").plugins.expose("chatRightPanel", panel);
	return { system, notebookSdk, panel };
}

describe("notebook plugin webRegister", () => {
	it("registers list_open and open with external exposure opted in", () => {
		const { system, notebookSdk } = makeSystem();
		webRegister(notebookSdk);

		const tools = system.services.toolRegistry.all();
		expect(tools.map((tool) => tool.id).sort()).toEqual(["notebook.list_open", "notebook.open"]);
		expect(tools.every((tool) => tool.exposeToModelContext)).toBe(true);
		expect(tools.find((tool) => tool.name === "list_open")?.annotations?.readOnlyHint).toBe(true);
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
});
