import { describe, expect, it } from "vitest";
import {
	createLayout,
	descriptor,
	flattenPanes,
	parseLayoutJson,
	type PaneLayout,
} from "@kilo-desktop/pane-layout";
import { applyLayoutTemplate, captureLayoutTemplate } from "./layout-template.js";
import {
	layoutTemplateSchema,
	type LayoutTemplate,
} from "../../../contracts/layout-presets/schemas.js";
import { EMPTY_SESSION_RIGHT_PANEL_STATE } from "../right-panel/right-panel-store.js";

const coding: LayoutTemplate = {
	version: 1,
	arrangement: "tiles",
	activePaneId: "chat",
	slots: [
		{ id: "chat", type: "chat" },
		{ id: "changes", type: "changes" },
		{ id: "terminal", type: "terminal" },
	],
	groups: [
		{ id: "left", tabs: ["chat"], activePaneId: "chat", width: 450, pinned: true },
		{
			id: "top",
			tabs: ["changes"],
			activePaneId: "changes",
			width: 550,
			pinned: false,
			stackId: "right",
			stackWeight: 0.6,
		},
		{
			id: "bottom",
			tabs: ["terminal"],
			activePaneId: "terminal",
			width: 550,
			pinned: false,
			stackId: "right",
			stackWeight: 0.4,
		},
	],
};

describe("saved layout templates", () => {
	it("omits documents and transient resources while normalizing surviving stacks and active tabs", () => {
		const layout = createLayout([
			descriptor({ id: "file", kind: "document", title: "secret.ts" }),
			descriptor({ id: "files", kind: "document", title: "Files" }),
			descriptor({ id: "temp", kind: "tool", title: "Loading" }),
		]);
		layout.groups[0] = { ...layout.groups[0]!, stackId: "s", stackWeight: 0.5 };
		layout.groups[1] = { ...layout.groups[1]!, stackId: "s", stackWeight: 0.5 };
		const result = captureLayoutTemplate(layout, {
			...EMPTY_SESSION_RIGHT_PANEL_STATE,
			tabs: [
				{
					instanceId: "file",
					definitionId: "files.files",
					title: "secret.ts",
					ordinal: 1,
					metadata: { relativePath: "secret.ts" },
				},
				{
					instanceId: "files",
					definitionId: "files.files",
					title: "Files",
					ordinal: 2,
					metadata: { workspaceDirectory: "/private/project" },
				},
				{
					instanceId: "temp",
					definitionId: "terminal.terminal",
					title: "Loading",
					ordinal: 1,
					transient: true,
				},
			],
		});
		expect(result.omittedTitles).toEqual(["secret.ts", "Loading"]);
		expect(result.template.slots).toEqual([{ id: "slot-1", type: "files" }]);
		expect(result.template.groups[0]?.stackId).toBeUndefined();
		expect(result.template.groups[0]?.stackWeight).toBeUndefined();
		expect(result.template.groups[0]?.activePaneId).toBe("slot-1");
		expect(JSON.stringify(result.template)).not.toContain("/private/project");
	});

	it("matches repeated pane roles one-to-one without consuming a file document as an explorer", () => {
		const template: LayoutTemplate = {
			version: 1,
			arrangement: "tiles",
			activePaneId: "one",
			slots: [
				{ id: "one", type: "terminal" },
				{ id: "two", type: "terminal" },
				{ id: "files", type: "files" },
			],
			groups: [
				{
					id: "tabs",
					tabs: ["one", "two", "files"],
					activePaneId: "two",
					width: 600,
					pinned: false,
				},
			],
		};
		const state = applyLayoutTemplate(template, "chat", {
			...EMPTY_SESSION_RIGHT_PANEL_STATE,
			tabs: [
				{ instanceId: "pty", definitionId: "terminal.terminal", title: "Terminal", ordinal: 1 },
				{
					instanceId: "doc",
					definitionId: "files.files",
					title: "Document",
					ordinal: 1,
					metadata: { relativePath: "file.py" },
				},
			],
		});
		expect(state.tabs.filter((tab) => tab.definitionId === "terminal.terminal")).toHaveLength(2);
		expect(state.tabs.filter((tab) => tab.definitionId === "files.files")).toHaveLength(2);
		expect(
			new Set(flattenPanes(parseLayoutJson(state.layoutJson)!).map((pane) => pane.id)).size,
		).toBe(4);
		expect(applyLayoutTemplate(template, "chat", state).tabs).toEqual(state.tabs);
	});
	it("keeps existing terminal identities, dirty documents, and unsupported panes accessible", () => {
		const terminal = {
			instanceId: "live-pty",
			definitionId: "terminal.terminal",
			title: "Server",
			ordinal: 1,
			metadata: { terminalSessionId: "original-draft" },
		};
		const document = {
			instanceId: "dirty-doc",
			definitionId: "files.files",
			title: "app.ts",
			ordinal: 1,
			metadata: { relativePath: "app.ts" },
			dirty: true,
		};
		const notebook = {
			instanceId: "notebook",
			definitionId: "notebook.notebook",
			title: "Analysis",
			ordinal: 1,
		};
		const state = applyLayoutTemplate(coding, "target", {
			...EMPTY_SESSION_RIGHT_PANEL_STATE,
			tabs: [terminal, document, notebook],
		});
		expect(state.tabs.find((tab) => tab.instanceId === terminal.instanceId)).toBe(terminal);
		expect(state.tabs.find((tab) => tab.instanceId === document.instanceId)).toBe(document);
		const layout = parseLayoutJson(state.layoutJson)!;
		expect(flattenPanes(layout).map((pane) => pane.id)).toContain("dirty-doc");
		expect(flattenPanes(layout).map((pane) => pane.id)).toContain("notebook");
		expect(state.tabs.filter((tab) => tab.definitionId === "terminal.terminal")).toHaveLength(1);
	});
	it("applies to a new chat with fresh resources and reuses them on repeat application", () => {
		const state = applyLayoutTemplate(coding, "target", EMPTY_SESSION_RIGHT_PANEL_STATE);
		expect(state.tabs.map((tab) => tab.definitionId)).toEqual(["git.changes", "terminal.terminal"]);
		expect(state.tabs.every((tab) => tab.metadata === undefined)).toBe(true);
		const layout = parseLayoutJson(state.layoutJson)!;
		expect(flattenPanes(layout)[0]?.id).toBe("agent:target");
		expect(layout.groups.map((group) => group.preferredWidth)).toEqual([450, 550, 550]);
		expect(layout.groups[1]?.stackId).toBe(layout.groups[2]?.stackId);
		const again = applyLayoutTemplate(coding, "target", state);
		expect(again.tabs).toEqual(state.tabs);
		expect(again.layoutJson).toBe(state.layoutJson);
		const other = applyLayoutTemplate(coding, "other", EMPTY_SESSION_RIGHT_PANEL_STATE);
		expect(other.tabs[1]?.instanceId).not.toBe(state.tabs[1]?.instanceId);
	});
	it("omits unavailable pane roles without persisting tabs or invalid stack geometry", () => {
		const state = applyLayoutTemplate(
			coding,
			"target",
			EMPTY_SESSION_RIGHT_PANEL_STATE,
			new Set(["terminal.terminal"]),
		);

		expect(state.tabs.map((tab) => tab.definitionId)).toEqual(["terminal.terminal"]);
		const layout = parseLayoutJson(state.layoutJson)!;
		expect(flattenPanes(layout).map((pane) => pane.id)).toEqual([
			"agent:target",
			state.tabs[0]!.instanceId,
		]);
		expect(layout.groups[1]).not.toHaveProperty("stackId");
		expect(layout.groups[1]).not.toHaveProperty("stackWeight");
		expect(layout.activePaneId).toBe("agent:target");
	});
	it("falls back to chat when filtering removes the entire template", () => {
		const state = applyLayoutTemplate(
			{
				version: 1,
				arrangement: "tiles",
				slots: [{ id: "changes", type: "changes" }],
				groups: [
					{
						id: "changes",
						tabs: ["changes"],
						activePaneId: "changes",
						width: 400,
						pinned: false,
					},
				],
			},
			"target",
			EMPTY_SESSION_RIGHT_PANEL_STATE,
			new Set(["terminal.terminal"]),
		);

		expect(state.tabs).toEqual([]);
		expect(flattenPanes(parseLayoutJson(state.layoutJson)!).map((pane) => pane.id)).toEqual([
			"agent:target",
		]);
		expect(state.chatPaneOpen).toBe(true);
	});
	it("captures coding geometry without copying resource identities or metadata", () => {
		const layout: PaneLayout = {
			...createLayout([
				descriptor({ id: "agent:source", kind: "agent", title: "Private chat" }),
				descriptor({ id: "diff", kind: "tool", title: "Changes" }),
				descriptor({ id: "pty", kind: "tool", title: "Secret command" }),
			]),
			activePaneId: "pty",
			sizes: { "group:agent:source": 450, "group:diff": 550, "group:pty": 550 },
		};
		layout.groups[1] = { ...layout.groups[1]!, stackId: "private-stack", stackWeight: 0.6 };
		layout.groups[2] = { ...layout.groups[2]!, stackId: "private-stack", stackWeight: 0.4 };
		const result = captureLayoutTemplate(layout, {
			arrangement: "tiles",
			activeTabId: "pty",
			planAnchorCallId: null,
			tabs: [
				{ instanceId: "diff", definitionId: "git.changes", title: "Changes", ordinal: 1 },
				{
					instanceId: "pty",
					definitionId: "terminal.terminal",
					title: "Secret command",
					ordinal: 1,
					metadata: { terminalSessionId: "source" },
				},
			],
		});
		expect(result.template.activePaneId).toBe("slot-3");
		expect(result.omittedTitles).toEqual([]);
		expect(result.template.slots.map((slot) => slot.type)).toEqual(["chat", "changes", "terminal"]);
		expect(result.template.groups.map((group) => group.width)).toEqual([450, 550, 550]);
		expect(result.template.groups.map((group) => group.stackWeight)).toEqual([undefined, 0.6, 0.4]);
		expect(result.template.groups[1]?.stackId).toBe(result.template.groups[2]?.stackId);
		expect(JSON.stringify(result.template)).not.toMatch(
			/source|private|Secret|pty|terminalSessionId/,
		);
		expect(layoutTemplateSchema.safeParse(result.template).success).toBe(true);
		const restored = applyLayoutTemplate(
			result.template,
			"new-chat",
			EMPTY_SESSION_RIGHT_PANEL_STATE,
		);
		expect(parseLayoutJson(restored.layoutJson)?.groups.map((group) => group.stackWeight)).toEqual([
			undefined,
			0.6,
			0.4,
		]);
		expect(parseLayoutJson(restored.layoutJson)?.activePaneId).toBe(restored.tabs[1]?.instanceId);
	});
});
