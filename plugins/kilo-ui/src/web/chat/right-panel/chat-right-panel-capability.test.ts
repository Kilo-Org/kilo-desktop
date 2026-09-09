import { beforeEach, describe, expect, it } from "vitest";

import {
	chatRightPanelCapability,
	createChatRightPanelCapability,
} from "./chat-right-panel-capability.js";
import { useRightPanelStore } from "./right-panel-store.js";

const SESSION = "session-1";

beforeEach(() => {
	useRightPanelStore.setState({ bySessionId: {} });
	chatRightPanelCapability.setFocusedSessionId(null);
});

describe("createChatRightPanelCapability", () => {
	it("tracks focused session id", () => {
		const panel = createChatRightPanelCapability();
		expect(panel.getFocusedSessionId()).toBeNull();
		panel.setFocusedSessionId(SESSION);
		expect(panel.getFocusedSessionId()).toBe(SESSION);
		panel.setFocusedSessionId(null);
		expect(panel.getFocusedSessionId()).toBeNull();
	});

	it("lists contributed tabs and reports the active instance", () => {
		const panel = createChatRightPanelCapability();
		panel.openContributedTab(SESSION, { id: "canvas.panel", title: "Canvas" });
		const active = panel.openContributedTab(SESSION, { id: "preview.panel", title: "Preview" });

		expect(panel.listTabs(SESSION)).toHaveLength(2);
		expect(panel.getActiveTabId(SESSION)).toBe(active.instanceId);
	});

	it("opens a contributed tab and returns the active instance", () => {
		const panel = createChatRightPanelCapability();
		const tab = panel.openContributedTab(SESSION, {
			id: "canvas.panel",
			title: "Canvas",
		});
		expect(tab.definitionId).toBe("canvas.panel");
		expect(tab.title).toBe("Canvas 1");
		expect(panel.listTabs(SESSION)).toEqual([tab]);
	});

	it("opens a restorable contributed tab with its backing resource identity", () => {
		const panel = createChatRightPanelCapability();
		const tab = panel.openContributedTab(
			SESSION,
			{ id: "notebook.notebook", title: "Notebook" },
			{
				instanceId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				title: "analysis.ipynb",
				metadata: { notebookPath: "/projects/analysis.ipynb" },
			},
		);

		expect(tab).toMatchObject({
			instanceId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			title: "analysis.ipynb",
			metadata: { notebookPath: "/projects/analysis.ipynb" },
		});
	});

	it("returns a contributed tab opened without changing the active tab", () => {
		const panel = createChatRightPanelCapability();
		const active = panel.openContributedTab(SESSION, { id: "canvas.panel", title: "Canvas" });
		const opened = panel.openContributedTab(
			SESSION,
			{ id: "preview.panel", title: "Preview" },
			{ activate: false, instanceId: "preview-1" },
		);

		expect(opened.instanceId).toBe("preview-1");
		expect(panel.getActiveTabId(SESSION)).toBe(active.instanceId);
	});

	it("reopens an existing contributed tab with the latest resource state", () => {
		const panel = createChatRightPanelCapability();
		panel.openContributedTab(
			SESSION,
			{ id: "files.files", title: "Files" },
			{
				instanceId: "file:/workspace/src/index.ts",
				title: "index.ts",
				iconKey: "src/index.ts",
				metadata: { workspaceDirectory: "/workspace", relativePath: "src/index.ts" },
			},
		);

		const reopened = panel.openContributedTab(
			SESSION,
			{ id: "files.files", title: "Files" },
			{
				instanceId: "file:/workspace/src/index.ts",
				title: "index.ts",
				iconKey: "src/index.ts",
				metadata: {
					workspaceDirectory: "/workspace",
					relativePath: "src/index.ts",
					line: "42",
				},
			},
		);

		expect(panel.listTabs(SESSION)).toHaveLength(1);
		expect(reopened.metadata).toEqual({
			workspaceDirectory: "/workspace",
			relativePath: "src/index.ts",
			line: "42",
		});
	});

	it("updates transient dirty state and owns tab lifecycle callbacks", () => {
		const panel = createChatRightPanelCapability();
		const tab = panel.openContributedTab(SESSION, { id: "canvas.panel", title: "Canvas" });
		const lifecycle = { save: async () => ({ outcome: "saved" as const }) };

		panel.updateTab(SESSION, tab.instanceId, { dirty: true });
		const unregister = panel.registerTabLifecycle(SESSION, tab.instanceId, lifecycle);

		expect(panel.listTabs(SESSION)[0]?.dirty).toBe(true);
		expect(panel.getTabLifecycle(SESSION, tab.instanceId)).toBe(lifecycle);
		unregister();
		expect(panel.getTabLifecycle(SESSION, tab.instanceId)).toBeUndefined();
	});

	it("updates a contributed tab through one state patch", () => {
		const panel = createChatRightPanelCapability();
		const tab = panel.openContributedTab(SESSION, { id: "notebook.notebook", title: "Notebook" });

		panel.updateTab(SESSION, tab.instanceId, {
			title: "analysis.ipynb",
			iconKey: "notebooks/analysis.ipynb",
			metadata: { notebookPath: "/projects/analysis.ipynb" },
		});

		expect(panel.listTabs(SESSION)[0]).toMatchObject({
			title: "analysis.ipynb",
			iconKey: "notebooks/analysis.ipynb",
			metadata: { notebookPath: "/projects/analysis.ipynb" },
		});
	});
});
