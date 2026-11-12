import { describe, expect, it, vi } from "vitest";

import {
	KernelDataCollection,
	KernelTelemetrySink,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";
import {
	createLayout,
	parseLayoutJson,
	serializeLayout,
	setActivePane,
} from "@kilo-desktop/pane-layout";

import { bootWorkSessions, storageWithWorkspaces, type MemoryStorage } from "../test-boot";
import { globToRegExp } from "../../contracts/model/openers";
import { paneTypeOf } from "./index";

/** A plugin with pane kinds and openers, declared in its manifest only. */
const contributor = testPlugin("test.panes", {
	manifest: {
		contributes: {
			extensions: {
				"kilo.work-sessions/pane-kind": [
					{ id: "terminal", title: "Terminal" },
					{ id: "changes", title: "Changes", singleton: true },
					{ id: "editor", title: "Editor" },
				],
				"kilo.work-sessions/opener": [
					{
						id: "files",
						match: { type: "test.panes/file" },
						pane: "test.panes/terminal",
						priority: -100,
					},
					{
						id: "notebooks",
						match: { type: "test.panes/file", pattern: "*.ipynb" },
						pane: "test.panes/editor",
					},
				],
			},
		},
	},
});

async function boot(storage: MemoryStorage = storageWithWorkspaces()) {
	const booted = await bootWorkSessions({ storage, plugins: [contributor] });
	const workSession = await booted.workSessions.methods.create({});
	const of = (workSessionId = workSession.id) => booted.panesOf(workSessionId);
	return { ...booted, workSession, of };
}

describe("panes", () => {
	it("places a pane opened as a tab in the active pane's group; other panes stay for the canvas", async () => {
		const { panes, workSession, of } = await boot();
		const target = { workSessionId: workSession.id };
		const a = await panes.methods.open({ ...target, kind: "test.panes/terminal" });
		const b = await panes.methods.open({ ...target, kind: "test.panes/terminal" });
		const saved = setActivePane(
			createLayout([
				{ id: a.id, kind: "tool", title: "a" },
				{ id: b.id, kind: "tool", title: "b" },
			]),
			a.id,
		);
		await panes.methods.setLayout({
			...target,
			layout: serializeLayout(saved),
			activePaneId: a.id,
		});

		const tab = await panes.methods.open({
			...target,
			kind: "test.panes/editor",
			placement: "tab",
		});
		const tabs = () =>
			parseLayoutJson(of()?.layout)?.groups.map((group) => group.tabs.map((t) => t.id));
		expect(tabs()).toEqual([[a.id, tab.id], [b.id]]);
		expect(parseLayoutJson(of()?.layout)?.activePaneId).toBe(tab.id);

		await panes.methods.open({ ...target, kind: "test.panes/terminal" });
		expect(tabs()).toEqual([[a.id, tab.id], [b.id]]);
	});

	it("opens panes numbered per kind, activating each", async () => {
		const { panes, workSession, of } = await boot();
		const opened: string[] = [];
		panes.on("opened", ({ pane }) => opened.push(pane.id));

		await panes.methods.open({ workSessionId: workSession.id, kind: "test.panes/terminal" });
		const second = await panes.methods.open({
			workSessionId: workSession.id,
			kind: "test.panes/terminal",
		});
		await panes.methods.open({
			workSessionId: workSession.id,
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

	it("names a pane of a kind nobody declares plainly", async () => {
		const { panes, workSession } = await boot();

		await expect(
			panes.methods.open({ workSessionId: workSession.id, kind: "gone.plugin/thing" }),
		).resolves.toMatchObject({ title: "Pane" });
	});

	it("looks panes up by <workSessionId>/<paneId>", async () => {
		const { panes, workSession } = await boot();
		const pane = await panes.methods.open({
			workSessionId: workSession.id,
			kind: "test.panes/terminal",
		});

		expect(panes.lookup(`${workSession.id}/${pane.id}`)).toEqual(pane);
	});

	it("shows a singleton kind's existing pane instead of opening another", async () => {
		const { panes, workSession, of } = await boot();

		const first = await panes.methods.open({
			workSessionId: workSession.id,
			kind: "test.panes/changes",
		});
		await panes.methods.open({ workSessionId: workSession.id, kind: "test.panes/terminal" });
		const again = await panes.methods.open({
			workSessionId: workSession.id,
			kind: "test.panes/changes",
		});

		expect(again.id).toBe(first.id);
		expect(of()?.panes).toHaveLength(2);
		expect(of()?.activePaneId).toBe(first.id);
	});

	it("reuses a named pane of the same kind, and refuses one of another kind", async () => {
		const { panes, workSession, of } = await boot();
		await panes.methods.open({
			workSessionId: workSession.id,
			kind: "test.panes/editor",
			paneId: "doc",
		});

		const updated = await panes.methods.open({
			workSessionId: workSession.id,
			kind: "test.panes/editor",
			paneId: "doc",
			title: "Renamed",
		});

		expect(updated).toMatchObject({ id: "doc", title: "Renamed" });
		expect(of()?.panes).toHaveLength(1);
		await expect(
			panes.methods.open({
				workSessionId: workSession.id,
				kind: "test.panes/terminal",
				paneId: "doc",
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("updates, activates and closes panes, moving activity to a neighbour", async () => {
		const { panes, workSession, of } = await boot();
		const target = { workSessionId: workSession.id };
		const a = await panes.methods.open({ ...target, kind: "test.panes/terminal" });
		const b = await panes.methods.open({ ...target, kind: "test.panes/terminal" });
		const closed: string[] = [];
		panes.on("closed", ({ pane }) => closed.push(pane.id));

		await panes.methods.update({ ...target, paneId: a.id, title: "Server", iconKey: "py" });
		await panes.methods.activate({ ...target, paneId: a.id });
		expect(of()?.panes[0]).toMatchObject({ title: "Server", iconKey: "py" });
		expect(of()?.activePaneId).toBe(a.id);

		await expect(panes.methods.close({ ...target, paneId: a.id })).resolves.toEqual({
			closed: true,
		});
		expect(of()?.activePaneId).toBe(b.id);
		await expect(panes.methods.close({ ...target, paneId: "gone" })).resolves.toEqual({
			closed: false,
		});
		expect(closed).toEqual([a.id]);
		await expect(panes.methods.activate({ ...target, paneId: "gone" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("sets and clears a pane's status and object", async () => {
		const { panes, workSession } = await boot();
		const target = { workSessionId: workSession.id };
		const pane = await panes.methods.open({
			...target,
			kind: "test.panes/editor",
			object: { type: "test.panes/file", id: "/a.ts" },
		});
		expect(pane.object).toEqual({ type: "test.panes/file", id: "/a.ts" });

		await expect(
			panes.methods.update({ ...target, paneId: pane.id, status: "attention" }),
		).resolves.toMatchObject({
			status: "attention",
			object: { type: "test.panes/file", id: "/a.ts" },
		});
		const cleared = await panes.methods.update({
			...target,
			paneId: pane.id,
			status: null,
			object: null,
		});

		expect(cleared.status).toBeUndefined();
		expect(cleared.object).toBeUndefined();
	});

	it("saves the canvas's layout and arrangement, and keeps them across restarts", async () => {
		const { panes, workSession, storage } = await boot();
		const target = { workSessionId: workSession.id };
		const pane = await panes.methods.open({ ...target, kind: "test.panes/terminal" });

		await panes.methods.setLayout({ ...target, layout: '{"groups":[]}', activePaneId: pane.id });
		await panes.methods.setLayout({ ...target, layout: '{"groups":[1]}', activePaneId: "gone" });
		await panes.methods.setArrangement({ ...target, arrangement: "carousel" });

		const restarted = await boot(storage);
		expect(restarted.panesOf(workSession.id)).toMatchObject({
			layout: '{"groups":[1]}',
			activePaneId: pane.id,
			arrangement: "carousel",
		});
	});

	it("opens objects in the highest-priority matching opener's pane, reusing the object's pane", async () => {
		const { panes, workSession, of } = await boot();
		const open = (ref: { type: string; id: string }) =>
			panes.methods.openObject({
				workSessionId: workSession.id,
				ref: ref as { type: `${string}/${string}`; id: string },
			});

		const notebook = await open({ type: "test.panes/file", id: "src/Analysis.IPYNB" });
		const again = await open({ type: "test.panes/file", id: "src/Analysis.IPYNB" });
		const text = await open({ type: "test.panes/file", id: "README.md" });
		const nothing = await open({ type: "test.panes/url", id: "https://example.com" });

		expect(notebook).toMatchObject({
			kind: "test.panes/editor",
			object: { type: "test.panes/file", id: "src/Analysis.IPYNB" },
			metadata: {},
		});
		expect(again?.id).toBe(notebook?.id);
		expect(text?.kind).toBe("test.panes/terminal");
		expect(nothing).toBeNull();
		expect(of()?.panes).toHaveLength(2);
	});

	it("opens an object in the background when asked", async () => {
		const { panes, workSession, of } = await boot();
		const first = await panes.methods.open({
			workSessionId: workSession.id,
			kind: "test.panes/terminal",
		});

		await panes.methods.openObject({
			workSessionId: workSession.id,
			ref: { type: "test.panes/file", id: "a.ipynb" },
			activate: false,
		});

		expect(of()?.activePaneId).toBe(first.id);
	});

	it("drops a deleted work session's panes", async () => {
		const { workSessions, panes, workSession, of } = await boot();
		await panes.methods.open({ workSessionId: workSession.id, kind: "test.panes/terminal" });

		await workSessions.methods.remove({ id: workSession.id });

		expect(of()).toBeUndefined();
	});
});

describe("pane telemetry", () => {
	it("reports panes opened and closed by origin's pane type", async () => {
		const delivered: TelemetryEnvelope[] = [];
		const sink = testPlugin("test.sink", {
			manifest: { contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } } },
			entry: {
				activate: (sdk) => {
					sdk.extensions.implement(KernelTelemetrySink, "sink", {
						deliver: (envelope) => void delivered.push(envelope),
					});
				},
			},
		});
		const booted = await bootWorkSessions({ plugins: [contributor, sink] });
		booted.kernel.kernelSdk.domainObjects.provide(KernelDataCollection, {
			initialState: { choice: true, allowed: true, installationId: "i", environment: "stable" },
			methods: { setChoice: () => {} },
		});
		const { id } = await booted.workSessions.methods.create({});

		const pane = await booted.panes.methods.open({
			workSessionId: id,
			kind: "test.panes/terminal",
		});
		await booted.panes.methods.close({ workSessionId: id, paneId: pane.id });

		await vi.waitFor(() =>
			expect(delivered.map(({ name, data }) => [name, data])).toEqual([
				["Pane Opened", { paneType: "test.panes/terminal" }],
				["Pane Closed", { paneType: "test.panes/terminal" }],
			]),
		);
	});

	it("names bundled kinds as origin did", () => {
		expect(paneTypeOf("kilo.chat/agent")).toBe("chat");
		expect(paneTypeOf("kilo.terminal/terminal")).toBe("terminal.terminal");
		expect(paneTypeOf("acme.tools/thing")).toBe("acme.tools/thing");
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
