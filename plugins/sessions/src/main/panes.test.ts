import { describe, expect, it } from "vitest";

import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { Panes, WorkSessions, SESSIONS_DEFINITIONS } from "../contracts";
import { createSessionsMainEntry } from "./entry";
import { globToRegExp } from "./panes";

/** A plugin with pane kinds and openers, declared in its manifest only. */
const contributor = testPlugin("test.panes", {
	manifest: {
		contributes: {
			extensions: {
				"kilo.sessions/pane-kind": [
					{ id: "terminal", title: "Terminal" },
					{ id: "changes", title: "Changes", singleton: true },
					{ id: "editor", title: "Editor" },
				],
				"kilo.sessions/opener": [
					{
						id: "notebooks",
						match: { type: "test/file", pattern: "*.ipynb" },
						pane: "test.panes/editor",
					},
					{ id: "files", match: { type: "test/file" }, pane: "test.panes/terminal" },
				],
			},
		},
	},
});

async function boot(storage = createMemoryStorage("/data/kilo.sessions")) {
	let id = 0;
	let paneId = 0;
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			{
				manifest,
				definitions: SESSIONS_DEFINITIONS,
				entry: createSessionsMainEntry({
					createId: () => `wses_${++id}`,
					createPaneId: () => `pane_${++paneId}`,
				}),
			},
			contributor,
		],
		hostServices: () => ({ storage }),
	});
	await kernel.start();
	const sessions = kernel.kernelSdk.domains.get(WorkSessions)!;
	const panes = kernel.kernelSdk.domains.get(Panes)!;
	const session = await sessions.methods.create({});
	const of = (sessionId = session.id) => panes.getState().bySession[sessionId];
	return { kernel, sessions, panes, session, of, storage };
}

describe("panes", () => {
	it("opens panes numbered per kind, activating each", async () => {
		const { panes, session, of } = await boot();
		const opened: string[] = [];
		panes.on("opened", ({ pane }) => opened.push(pane.id));

		await panes.methods.open({ sessionId: session.id, kind: "test.panes/terminal" });
		const second = await panes.methods.open({ sessionId: session.id, kind: "test.panes/terminal" });
		await panes.methods.open({
			sessionId: session.id,
			kind: "test.panes/editor",
			title: "notes.md",
			metadata: { path: "notes.md" },
			activate: false,
		});

		expect(of()?.panes.map(({ title, ordinal }) => [title, ordinal])).toEqual([
			["Terminal", 1],
			["Terminal 2", 2],
			["notes.md", 1],
		]);
		expect(of()?.activePaneId).toBe(second.id);
		expect(of()?.arrangement).toBe("tiles");
		expect(opened).toEqual(["pane_1", "pane_2", "pane_3"]);
	});

	it("shows a singleton kind's existing pane instead of opening another", async () => {
		const { panes, session, of } = await boot();

		const first = await panes.methods.open({ sessionId: session.id, kind: "test.panes/changes" });
		await panes.methods.open({ sessionId: session.id, kind: "test.panes/terminal" });
		const again = await panes.methods.open({ sessionId: session.id, kind: "test.panes/changes" });

		expect(again.id).toBe(first.id);
		expect(of()?.panes).toHaveLength(2);
		expect(of()?.activePaneId).toBe(first.id);
	});

	it("reuses a named pane of the same kind, and refuses one of another kind", async () => {
		const { panes, session, of } = await boot();
		await panes.methods.open({ sessionId: session.id, kind: "test.panes/editor", paneId: "doc" });

		const updated = await panes.methods.open({
			sessionId: session.id,
			kind: "test.panes/editor",
			paneId: "doc",
			title: "Renamed",
		});

		expect(updated).toMatchObject({ id: "doc", title: "Renamed" });
		expect(of()?.panes).toHaveLength(1);
		await expect(
			panes.methods.open({ sessionId: session.id, kind: "test.panes/terminal", paneId: "doc" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("updates, activates and closes panes, moving activity to a neighbour", async () => {
		const { panes, session, of } = await boot();
		const a = await panes.methods.open({ sessionId: session.id, kind: "test.panes/terminal" });
		const b = await panes.methods.open({ sessionId: session.id, kind: "test.panes/terminal" });
		const closed: string[] = [];
		panes.on("closed", ({ pane }) => closed.push(pane.id));

		await panes.methods.update({
			sessionId: session.id,
			paneId: a.id,
			title: "Server",
			iconKey: "py",
		});
		await panes.methods.activate({ sessionId: session.id, paneId: a.id });
		expect(of()?.panes[0]).toMatchObject({ title: "Server", iconKey: "py" });
		expect(of()?.activePaneId).toBe(a.id);

		await expect(panes.methods.close({ sessionId: session.id, paneId: a.id })).resolves.toEqual({
			closed: true,
		});
		expect(of()?.activePaneId).toBe(b.id);
		await expect(panes.methods.close({ sessionId: session.id, paneId: "gone" })).resolves.toEqual({
			closed: false,
		});
		expect(closed).toEqual([a.id]);
		await expect(
			panes.methods.activate({ sessionId: session.id, paneId: "gone" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("saves the canvas's layout and arrangement, and keeps them across restarts", async () => {
		const { panes, session, storage } = await boot();
		const pane = await panes.methods.open({ sessionId: session.id, kind: "test.panes/terminal" });

		await panes.methods.setLayout({
			sessionId: session.id,
			layout: '{"groups":[]}',
			activePaneId: pane.id,
		});
		await panes.methods.setLayout({
			sessionId: session.id,
			layout: '{"groups":[1]}',
			activePaneId: "gone",
		});
		await panes.methods.setArrangement({ sessionId: session.id, arrangement: "carousel" });

		const restarted = await boot(storage);
		expect(restarted.panes.getState().bySession[session.id]).toMatchObject({
			layout: '{"groups":[1]}',
			activePaneId: pane.id,
			arrangement: "carousel",
		});
	});

	it("opens objects in the first matching opener's pane, reusing the object's pane", async () => {
		const { panes, session, of } = await boot();

		const notebook = await panes.methods.openObject({
			sessionId: session.id,
			ref: { type: "test/file", id: "src/Analysis.IPYNB" },
		});
		const again = await panes.methods.openObject({
			sessionId: session.id,
			ref: { type: "test/file", id: "src/Analysis.IPYNB" },
		});
		const text = await panes.methods.openObject({
			sessionId: session.id,
			ref: { type: "test/file", id: "README.md" },
		});
		const nothing = await panes.methods.openObject({
			sessionId: session.id,
			ref: { type: "test/url", id: "https://example.com" },
		});

		expect(notebook).toMatchObject({
			kind: "test.panes/editor",
			metadata: { objectType: "test/file", objectId: "src/Analysis.IPYNB" },
		});
		expect(again?.id).toBe(notebook?.id);
		expect(text?.kind).toBe("test.panes/terminal");
		expect(nothing).toBeNull();
		expect(of()?.panes).toHaveLength(2);
	});

	it("drops a deleted session's panes", async () => {
		const { sessions, panes, session, of } = await boot();
		await panes.methods.open({ sessionId: session.id, kind: "test.panes/terminal" });

		await sessions.methods.remove({ id: session.id });

		expect(of()).toBeUndefined();
	});

	it("takes over origin's panes once, for sessions it knows", async () => {
		const { kernel, panes, session, of } = await boot();
		const ownUi = kernel.sdkFor("kilo.sessions").domains.get(Panes)!;
		const legacy = {
			state: {
				bySessionId: {
					[session.id]: {
						activeTabId: "t2",
						arrangement: "carousel",
						layoutJson: '{"groups":[]}',
						tabs: [
							{
								instanceId: "t1",
								definitionId: "terminal.terminal",
								title: "Terminal",
								ordinal: 1,
							},
							{
								instanceId: "t2",
								definitionId: "files.files",
								title: "app.py",
								iconKey: "py",
								ordinal: 1,
								metadata: { relativePath: "app.py", stray: 3 },
							},
							{ instanceId: "t3", definitionId: "someone.else", title: "?", ordinal: 1 },
						],
					},
					wses_unknown: { tabs: [] },
				},
			},
			version: 1,
		};

		await ownUi.methods.importLegacy({ state: legacy });
		await ownUi.methods.importLegacy({ state: { state: { bySessionId: {} } } });

		expect(of()).toEqual({
			panes: [
				{
					id: `agent:${session.id}`,
					kind: "kilo.chat/agent",
					title: session.title,
					metadata: {},
					ordinal: 1,
				},
				{ id: "t1", kind: "kilo.terminal/terminal", title: "Terminal", metadata: {}, ordinal: 1 },
				{
					id: "t2",
					kind: "kilo.files/files",
					title: "app.py",
					iconKey: "py",
					metadata: { relativePath: "app.py" },
					ordinal: 1,
				},
			],
			activePaneId: "t2",
			layout: '{"groups":[]}',
			arrangement: "carousel",
		});
		expect(panes.getState().bySession.wses_unknown).toBeUndefined();
		await expect(panes.methods.importLegacy({ state: legacy })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
	});

	it("hands origin's plan and subagent tabs to kilo.chat, with the plan's revision", async () => {
		const { kernel, session, of } = await boot();
		const ownUi = kernel.sdkFor("kilo.sessions").domains.get(Panes)!;

		await ownUi.methods.importLegacy({
			state: {
				state: {
					bySessionId: {
						[session.id]: {
							chatPaneOpen: false,
							planAnchorCallId: "call_write",
							planNewestAnchorCallIdAtOpen: "call_exit",
							tabs: [
								{ instanceId: "plan", definitionId: "kilo-ui.plan", title: "Plan", ordinal: 1 },
								{
									instanceId: "subagent:ses_child",
									definitionId: "kilo-ui.subagent",
									title: "Audit login",
									ordinal: 1,
									metadata: { childSessionId: "ses_child" },
								},
							],
						},
					},
				},
			},
		});

		expect(of()?.panes).toEqual([
			{
				id: "plan",
				kind: "kilo.chat/plan",
				title: "Plan",
				metadata: { planAnchorCallId: "call_write", planNewestAnchorCallIdAtOpen: "call_exit" },
				ordinal: 1,
			},
			{
				id: "subagent:ses_child",
				kind: "kilo.chat/subagent",
				title: "Audit login",
				metadata: { childSessionId: "ses_child" },
				ordinal: 1,
			},
		]);
	});

	it("hands origin's notebook tabs to kilo.notebook, keeping their notebooks", async () => {
		const { kernel, session, of } = await boot();
		const ownUi = kernel.sdkFor("kilo.sessions").domains.get(Panes)!;
		const scratch = "669d39ec-39d6-4160-815c-b46e170cde8d";

		await ownUi.methods.importLegacy({
			state: {
				state: {
					bySessionId: {
						[session.id]: {
							chatPaneOpen: false,
							tabs: [
								{
									instanceId: scratch,
									definitionId: "notebook.notebook",
									title: "Notebook",
									ordinal: 1,
								},
								{
									instanceId: "tab-2",
									definitionId: "notebook.notebook",
									title: "analysis.ipynb",
									ordinal: 2,
									metadata: {
										notebookPath: "/work/analysis.ipynb",
										notebookId: "0b5e4a52-61a4-4f0c-9b83-1d1f2f9a1c3e",
										notebookOpenState: "ready",
									},
								},
							],
						},
					},
				},
			},
		});

		expect(of()?.panes).toEqual([
			{ id: scratch, kind: "kilo.notebook/notebook", title: "Notebook", metadata: {}, ordinal: 1 },
			{
				id: "tab-2",
				kind: "kilo.notebook/notebook",
				title: "analysis.ipynb",
				metadata: {
					notebookPath: "/work/analysis.ipynb",
					notebookId: "0b5e4a52-61a4-4f0c-9b83-1d1f2f9a1c3e",
					notebookOpenState: "ready",
				},
				ordinal: 2,
			},
		]);
	});

	it("leaves out a chat pane origin had closed, and sessions with nothing open", async () => {
		const { kernel, session, of } = await boot();
		const ownUi = kernel.sdkFor("kilo.sessions").domains.get(Panes)!;

		await ownUi.methods.importLegacy({
			state: { state: { bySessionId: { [session.id]: { chatPaneOpen: false, tabs: [] } } } },
		});

		expect(of()).toBeUndefined();
	});
});

describe("opener globs", () => {
	it("match within a segment, across segments, and one character", () => {
		expect(globToRegExp("*.ipynb").test("deep/dir/a.ipynb")).toBe(true);
		expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
		expect(globToRegExp("src/**/*.ts").test("src/a/b.ts")).toBe(true);
		expect(globToRegExp("file?.txt").test("file1.txt")).toBe(true);
		expect(globToRegExp("a+b.txt").test("a+b.txt")).toBe(true);
	});
});
