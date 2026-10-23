import { describe, expect, it } from "vitest";

import {
	createLayout,
	descriptor,
	findPane,
	findPaneGroup,
	flattenPanes,
	movePaneToGroup,
	setActivePane,
} from "@kilo-desktop/pane-layout";

import {
	agentPaneId,
	applyAgentPaneTitle,
	ensureAgentPane,
	isAgentPaneId,
	mergeArtifactPanes,
	paneKindForDefinition,
	rewritePaneId,
	syncChatLayout,
} from "./pane-layout-state.js";

describe("paneKindForDefinition", () => {
	it("matches known definitions exactly", () => {
		expect(paneKindForDefinition("files.files")).toBe("document");
		expect(paneKindForDefinition("notebook.notebook")).toBe("notebook");
		expect(paneKindForDefinition("profile.viewer")).toBe("tool");
	});
});

describe("ensureAgentPane", () => {
	it("adds the chat pane when the layout is empty", () => {
		const layout = ensureAgentPane(createLayout([]), "session-1");
		expect(flattenPanes(layout).map((pane) => pane.id)).toEqual(["agent:session-1"]);
		expect(layout.activePaneId).toBe("agent:session-1");
		expect(findPane(layout, "agent:session-1")?.title).toBe("New session");
	});

	it("does not duplicate an existing chat pane", () => {
		const layout = createLayout([
			descriptor({ id: "agent:session-1", kind: "agent", title: "Chat" }),
		]);
		expect(ensureAgentPane(layout, "session-1")).toBe(layout);
	});

	it("adopts a chat pane saved under another id", () => {
		const layout = createLayout([
			descriptor({ id: "agent:draft", kind: "agent", title: "Chat" }),
			descriptor({ id: "files-1", kind: "document", title: "Files" }),
		]);
		const claimed = ensureAgentPane(layout, "session-1");
		expect(flattenPanes(claimed).map((pane) => pane.id)).toEqual(["agent:session-1", "files-1"]);
		expect(claimed.activePaneId).toBe("agent:session-1");
	});

	it("puts a missing chat pane in front of an existing files explorer", () => {
		const layout = ensureAgentPane(
			createLayout([descriptor({ id: "files:explorer", kind: "document", title: "Files" })]),
			"session-1",
		);
		expect(flattenPanes(layout).map((pane) => pane.id)).toEqual([
			"agent:session-1",
			"files:explorer",
		]);
	});
});

describe("rewritePaneId", () => {
	it("keeps a file pane active when the chat pane id is remapped", () => {
		const layout = setActivePane(
			createLayout([
				descriptor({ id: "agent:local-1", kind: "agent", title: "Chat" }),
				descriptor({ id: "file:readme.md", kind: "document", title: "readme.md" }),
			]),
			"file:readme.md",
		);
		const rewritten = rewritePaneId(layout, "agent:local-1", "agent:remote-1");
		expect(flattenPanes(rewritten).map((pane) => pane.id)).toEqual([
			"agent:remote-1",
			"file:readme.md",
		]);
		expect(rewritten.activePaneId).toBe("file:readme.md");
	});
});

describe("mergeArtifactPanes", () => {
	it("gives the default files explorer a narrower preferred width", () => {
		const layout = createLayout([descriptor({ id: "agent:1", kind: "agent", title: "Chat" })]);
		const merged = mergeArtifactPanes(layout, [
			{
				instanceId: "files:explorer",
				definitionId: "files.files",
				title: "Files",
				ordinal: 1,
			},
		]);

		expect(findPaneGroup(merged, "files:explorer")?.preferredWidth).toBe(280);
	});

	it("adds contributed artifact panes and drops closed ones", () => {
		const layout = createLayout([descriptor({ id: "agent:1", kind: "agent", title: "Chat" })]);
		const merged = mergeArtifactPanes(layout, [
			{ instanceId: "files-1", definitionId: "files.files", title: "Files", ordinal: 1 },
		]);
		expect(flattenPanes(merged).map((pane) => pane.id)).toEqual(["agent:1", "files-1"]);
		expect(merged.activePaneId).toBe("agent:1");
		expect(findPaneGroup(merged, "files-1")?.tabs).toHaveLength(1);
		expect(isAgentPaneId("agent:1")).toBe(true);
		expect(isAgentPaneId("files-1")).toBe(false);
		const closed = mergeArtifactPanes(merged, []);
		expect(flattenPanes(closed).map((pane) => pane.id)).toEqual(["agent:1"]);
	});

	it("does not steal focus from Chat when a file pane is already in the layout", () => {
		const layout = setActivePane(
			createLayout([
				descriptor({ id: "agent:1", kind: "agent", title: "Chat" }),
				descriptor({ id: "files-1", kind: "document", title: "Files" }),
				descriptor({ id: "file:readme.md", kind: "document", title: "readme.md" }),
			]),
			"agent:1",
		);
		const merged = mergeArtifactPanes(layout, [
			{ instanceId: "files-1", definitionId: "files.files", title: "Files", ordinal: 1 },
			{
				instanceId: "file:readme.md",
				definitionId: "files.files",
				title: "readme.md",
				ordinal: 2,
			},
		]);
		expect(merged.activePaneId).toBe("agent:1");
	});

	it("focuses a newly added pane when that tab is already active", () => {
		const layout = createLayout([descriptor({ id: "agent:1", kind: "agent", title: "Chat" })]);
		const merged = mergeArtifactPanes(
			layout,
			[{ instanceId: "files-1", definitionId: "files.files", title: "Files", ordinal: 1 }],
			"files-1",
		);
		expect(merged.activePaneId).toBe("files-1");
	});

	it("places a new files explorer immediately after chat", () => {
		const layout = createLayout([
			descriptor({ id: "agent:1", kind: "agent", title: "Chat" }),
			descriptor({ id: "canvas-1", kind: "tool", title: "Canvas" }),
		]);
		const merged = mergeArtifactPanes(layout, [
			{ instanceId: "canvas-1", definitionId: "canvas.canvas", title: "Canvas", ordinal: 1 },
			{
				instanceId: "files:explorer",
				definitionId: "files.files",
				title: "Files",
				ordinal: 2,
			},
		]);
		expect(merged.groups.map((group) => group.tabs.map((pane) => pane.id))).toEqual([
			["agent:1"],
			["files:explorer"],
			["canvas-1"],
		]);
	});

	it("opens explorer files into a neighbor group instead of a new column each time", () => {
		const layout = createLayout([
			descriptor({ id: "agent:1", kind: "agent", title: "Chat" }),
			descriptor({ id: "files:explorer", kind: "document", title: "Files" }),
		]);
		const merged = mergeArtifactPanes(layout, [
			{
				instanceId: "files:explorer",
				definitionId: "files.files",
				title: "Files",
				ordinal: 1,
			},
			{
				instanceId: "file:files:explorer:/ws/readme.md",
				definitionId: "files.files",
				title: "readme.md",
				ordinal: 2,
				metadata: {
					explorerId: "files:explorer",
					workspaceDirectory: "/ws",
					relativePath: "readme.md",
				},
			},
			{
				instanceId: "file:files:explorer:/ws/notes.md",
				definitionId: "files.files",
				title: "notes.md",
				ordinal: 3,
				metadata: {
					explorerId: "files:explorer",
					workspaceDirectory: "/ws",
					relativePath: "notes.md",
				},
			},
		]);
		expect(merged.groups.map((group) => group.tabs.map((pane) => pane.id))).toEqual([
			["agent:1"],
			["files:explorer"],
			["file:files:explorer:/ws/readme.md", "file:files:explorer:/ws/notes.md"],
		]);
	});

	it("groups sequential explorer files even when tabs omit explorerId metadata", () => {
		const explorer = {
			instanceId: "files:explorer",
			definitionId: "files.files",
			title: "Files",
			ordinal: 1,
		};
		const readme = {
			instanceId: "file:/ws/readme.md",
			definitionId: "files.files",
			title: "readme.md",
			ordinal: 2,
			metadata: { workspaceDirectory: "/ws", relativePath: "readme.md" },
		};
		const notes = {
			instanceId: "file:/ws/notes.md",
			definitionId: "files.files",
			title: "notes.md",
			ordinal: 3,
			metadata: { workspaceDirectory: "/ws", relativePath: "notes.md" },
		};
		const initial = mergeArtifactPanes(
			createLayout([
				descriptor({ id: "agent:1", kind: "agent", title: "Chat" }),
				descriptor({ id: "files:explorer", kind: "document", title: "Files" }),
			]),
			[explorer, readme],
		);
		const merged = mergeArtifactPanes(initial, [explorer, readme, notes]);
		expect(merged.groups.map((group) => group.tabs.map((pane) => pane.id))).toEqual([
			["agent:1"],
			["files:explorer"],
			["file:/ws/readme.md", "file:/ws/notes.md"],
		]);
	});

	it("inserts the first explorer file beside that explorer, not at the end of the canvas", () => {
		const layout = createLayout([
			descriptor({ id: "agent:1", kind: "agent", title: "Chat" }),
			descriptor({ id: "files:explorer", kind: "document", title: "Files" }),
			descriptor({ id: "canvas-1", kind: "tool", title: "Canvas" }),
		]);
		const merged = mergeArtifactPanes(layout, [
			{
				instanceId: "files:explorer",
				definitionId: "files.files",
				title: "Files",
				ordinal: 1,
			},
			{ instanceId: "canvas-1", definitionId: "canvas.canvas", title: "Canvas", ordinal: 2 },
			{
				instanceId: "file:files:explorer:/ws/readme.md",
				definitionId: "files.files",
				title: "readme.md",
				ordinal: 3,
				metadata: {
					explorerId: "files:explorer",
					workspaceDirectory: "/ws",
					relativePath: "readme.md",
				},
			},
		]);
		expect(merged.groups.map((group) => group.tabs.map((pane) => pane.id))).toEqual([
			["agent:1"],
			["files:explorer"],
			["file:files:explorer:/ws/readme.md"],
			["canvas-1"],
		]);
	});

	it("gives a second explorer its own document group", () => {
		const layout = createLayout([
			descriptor({ id: "agent:1", kind: "agent", title: "Chat" }),
			descriptor({ id: "files:explorer", kind: "document", title: "Files" }),
			descriptor({ id: "files:other", kind: "document", title: "Files 2" }),
		]);
		const merged = mergeArtifactPanes(layout, [
			{
				instanceId: "files:explorer",
				definitionId: "files.files",
				title: "Files",
				ordinal: 1,
			},
			{
				instanceId: "files:other",
				definitionId: "files.files",
				title: "Files 2",
				ordinal: 2,
			},
			{
				instanceId: "file:files:explorer:/ws/readme.md",
				definitionId: "files.files",
				title: "readme.md",
				ordinal: 3,
				metadata: {
					explorerId: "files:explorer",
					workspaceDirectory: "/ws",
					relativePath: "readme.md",
				},
			},
			{
				instanceId: "file:files:other:/ws/plot.py",
				definitionId: "files.files",
				title: "plot.py",
				ordinal: 4,
				metadata: {
					explorerId: "files:other",
					workspaceDirectory: "/ws",
					relativePath: "plot.py",
				},
			},
		]);
		expect(merged.groups.map((group) => group.tabs.map((pane) => pane.id))).toEqual([
			["agent:1"],
			["files:explorer"],
			["file:files:explorer:/ws/readme.md"],
			["files:other"],
			["file:files:other:/ws/plot.py"],
		]);
	});

	it("updates an artifact pane title without changing its group", () => {
		const initial = createLayout([
			descriptor({ id: "agent:1", kind: "agent", title: "Chat" }),
			descriptor({ id: "files-1", kind: "document", title: "Files" }),
			descriptor({ id: "file:readme.md", kind: "document", title: "Untitled" }),
		]);
		const filesGroupId = findPaneGroup(initial, "files-1")!.id;
		const layout = movePaneToGroup(initial, "file:readme.md", filesGroupId);
		const merged = mergeArtifactPanes(layout, [
			{ instanceId: "files-1", definitionId: "files.files", title: "Files", ordinal: 1 },
			{
				instanceId: "file:readme.md",
				definitionId: "files.files",
				title: "readme.md",
				ordinal: 2,
			},
		]);
		expect(findPane(merged, "file:readme.md")?.title).toBe("readme.md");
		expect(findPaneGroup(merged, "file:readme.md")?.id).toBe(filesGroupId);
		expect(findPaneGroup(merged, "file:readme.md")?.tabs.map((pane) => pane.id)).toEqual([
			"files-1",
			"file:readme.md",
		]);
	});
});

describe("applyAgentPaneTitle", () => {
	it("renames the chat pane and leaves artifact panes alone", () => {
		const layout = createLayout([
			descriptor({ id: agentPaneId("session-1"), kind: "agent", title: "Chat" }),
			descriptor({ id: "files-1", kind: "document", title: "Files" }),
		]);
		const titled = applyAgentPaneTitle(layout, "session-1", "greeting");
		expect(flattenPanes(titled).map((pane) => pane.title)).toEqual(["greeting", "Files"]);
		expect(applyAgentPaneTitle(layout, "session-1", "Chat")).toBe(layout);
		expect(
			findPane(applyAgentPaneTitle(layout, "session-1", "  "), agentPaneId("session-1"))?.title,
		).toBe("New session");
	});
});

describe("syncChatLayout", () => {
	it("always keeps one chat pane and mirrors contributed tabs", () => {
		const synced = syncChatLayout({
			layout: createLayout([]),
			sessionId: "session-1",
			tabs: [{ instanceId: "files-1", definitionId: "files.files", title: "Files", ordinal: 1 }],
			title: "greeting",
		});
		expect(flattenPanes(synced).map((pane) => pane.id)).toEqual(["agent:session-1", "files-1"]);
		expect(findPane(synced, "agent:session-1")?.title).toBe("greeting");
	});
});
