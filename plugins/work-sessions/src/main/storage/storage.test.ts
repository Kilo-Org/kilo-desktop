import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import type { LayoutTemplate } from "../../contracts";
import { bootWorkSessions, type MemoryStorage } from "../test-boot";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "kilo-work-sessions-storage-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function legacy(pluginId: string, namespace: string, value: unknown): Promise<string> {
	const dir = path.join(root, pluginId);
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${namespace}.json`);
	await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
	return file;
}

const ownStorage = () => createMemoryStorage(path.join(root, "kilo.work-sessions"));

/** Boots with the real legacy reader, reading the sibling folders under `root`. */
const boot = (storage: MemoryStorage = ownStorage(), logger?: { warn: (m: string) => void }) =>
	bootWorkSessions({
		storage,
		core: false,
		...(logger
			? {
					logger: {
						debug: () => {},
						info: () => {},
						warn: logger.warn,
						error: (message: string) => logger.warn(`error: ${message}`),
					},
				}
			: {}),
	});

const WORKSPACE = {
	id: "w1",
	name: "App",
	color: "#34D399",
	folders: [{ id: "f1", path: "/projects/app", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 2,
};

const legacySession = (id: string, fields: Record<string, unknown> = {}) => ({
	id,
	title: `Session ${id}`,
	titleSource: "chat",
	pinned: false,
	archived: false,
	archiveChangedAt: 5,
	workspaceId: "w1",
	worktreeBranch: null,
	directory: "/projects/app",
	chatIds: ["ses_a"],
	createdAt: 5,
	updatedAt: 6,
	...fields,
});

const TEMPLATE: LayoutTemplate = {
	version: 2,
	arrangement: "tiles",
	slots: [{ id: "slot-1", kind: "kilo.terminal/terminal" }],
	groups: [{ id: "g1", tabs: ["slot-1"], activePaneId: "slot-1", width: 480, pinned: false }],
};

describe("adopting the predecessors' storage", () => {
	it("takes over kilo.workspaces' workspaces and the active one", async () => {
		await legacy("kilo.workspaces", "workspaces", {
			workspaces: [WORKSPACE, { id: "broken" }],
			activeId: "w1",
			importedFromOrigin: true,
		});

		const { workspaces, storage } = await boot();

		expect(workspaces.getState()).toMatchObject({ workspaces: [WORKSPACE], activeId: "w1" });
		expect(storage.saved.get("workspaces")).toMatchObject({ importedFromOrigin: true });
	});

	it("takes over kilo.sessions' work sessions, their worktrees becoming copies", async () => {
		await legacy("kilo.sessions", "sessions", {
			sessions: [
				legacySession("wses_new", {
					worktreeBranch: "kilo/brave-fox",
					directory: "/projects/app/.kilo/worktrees/brave-fox",
					isolation: "new-worktree",
					baseRef: "origin/main",
					worktreeCreated: true,
				}),
				legacySession("wses_existing", {
					worktreeBranch: "kilo/old",
					isolation: "existing-worktree",
				}),
				legacySession("wses_local", { isolation: "local" }),
				legacySession("wses_adopted"),
			],
			importedFromOrigin: true,
			legacyPinsImported: true,
			pendingPinnedChatIds: ["ses_x"],
			originArchivesReopened: true,
		});

		const { list, storage } = await boot();

		expect(
			list().map(({ id, branch, isolation, copyCreated }) => [id, branch, isolation, copyCreated]),
		).toEqual([
			["wses_new", "kilo/brave-fox", "new-copy", true],
			["wses_existing", "kilo/old", "existing-copy", undefined],
			["wses_local", null, "local", undefined],
			["wses_adopted", null, undefined, undefined],
		]);
		expect(list()[0]).not.toHaveProperty("worktreeBranch");
		expect(storage.saved.get("work-sessions")).toMatchObject({
			importedFromOrigin: true,
			originArchivesReopened: true,
		});
	});

	it("takes over kilo.sessions' panes, an opened object becoming the pane's object", async () => {
		await legacy("kilo.sessions", "panes", {
			bySession: {
				wses_1: {
					panes: [
						{
							id: "p1",
							kind: "kilo.files/files",
							title: "app.py",
							metadata: {
								objectType: "kilo.workspaces/file",
								objectId: "/projects/app/app.py",
								line: "3",
							},
							ordinal: 1,
						},
						{
							id: "p2",
							kind: "kilo.browser/browser",
							title: "Docs",
							metadata: { objectType: "kilo.browser/url", objectId: "https://example.com" },
							ordinal: 1,
						},
						{
							id: "p3",
							kind: "kilo.terminal/terminal",
							title: "Terminal",
							metadata: {},
							ordinal: 1,
						},
					],
					activePaneId: "p1",
					layout: '{"groups":[]}',
					arrangement: "carousel",
				},
				wses_broken: { panes: "nope" },
			},
			legacyImported: true,
		});

		const { panesOf, panes } = await boot();

		expect(panesOf("wses_1")).toEqual({
			panes: [
				{
					id: "p1",
					kind: "kilo.files/files",
					title: "app.py",
					object: { type: "kilo.work-sessions/file", id: "/projects/app/app.py" },
					metadata: { line: "3" },
					ordinal: 1,
				},
				{
					id: "p2",
					kind: "kilo.browser/browser",
					title: "Docs",
					object: { type: "kilo.work-sessions/url", id: "https://example.com" },
					metadata: {},
					ordinal: 1,
				},
				{ id: "p3", kind: "kilo.terminal/terminal", title: "Terminal", metadata: {}, ordinal: 1 },
			],
			activePaneId: "p1",
			layout: '{"groups":[]}',
			arrangement: "carousel",
		});
		expect(panes.getState().byWorkSession).not.toHaveProperty("wses_broken");
	});

	it("takes over kilo.workbench's layout presets and the default one", async () => {
		await legacy("kilo.workbench", "layouts", {
			presets: [{ id: "p1", name: "Code", template: TEMPLATE }, { id: "bad" }],
			defaultPresetId: "p1",
			importedFromOrigin: true,
		});

		const { layoutPresets, storage } = await boot();

		expect(layoutPresets().getState()).toEqual({
			presets: [{ id: "p1", name: "Code", template: TEMPLATE }],
			defaultPresetId: "p1",
		});
		expect(storage.saved.get("layout-presets")).toMatchObject({ importedFromOrigin: true });
	});

	it("adopts once: what is changed afterwards is never undone", async () => {
		await legacy("kilo.workspaces", "workspaces", { workspaces: [WORKSPACE], activeId: null });
		const storage = ownStorage();
		const first = await boot(storage);
		await first.workspaces.methods.remove({ id: "w1" });

		const second = await boot(storage);

		expect(second.workspaces.getState().workspaces).toEqual([]);
	});

	it("starts empty without predecessors, and counts a corrupt file as nothing to adopt", async () => {
		await legacy("kilo.workbench", "layouts", "{not json");
		const storage = ownStorage();

		const { list, layoutPresets } = await boot(storage);

		expect(list()).toEqual([]);
		expect(layoutPresets().getState().presets).toEqual([]);
		expect(storage.saved.get("adoption")).toMatchObject({
			adopted: [
				"kilo.workspaces/workspaces",
				"kilo.sessions/sessions",
				"kilo.sessions/panes",
				"kilo.workbench/layouts",
			],
		});
	});

	it("tries again next launch when a predecessor can't be read, keeping what was saved since on top", async () => {
		const file = path.join(root, "kilo.sessions", "sessions.json");
		await mkdir(file, { recursive: true }); // A folder can't be read as a file.
		const storage = ownStorage();
		const warnings: string[] = [];
		const first = await boot(storage, { warn: (message) => warnings.push(message) });
		expect(warnings).toEqual(
			expect.arrayContaining([expect.stringContaining("Could not adopt kilo.sessions/sessions")]),
		);
		expect(warnings.filter((warning) => warning.startsWith("error"))).toEqual([]);
		const mine = await first.workSessions.methods.create({ title: "Mine" });
		await rm(file, { recursive: true });
		await legacy("kilo.sessions", "sessions", {
			sessions: [legacySession(mine.id, { title: "Old" }), legacySession("wses_old")],
		});

		const second = await boot(storage);

		expect(second.list().map(({ id, title }) => [id, title])).toEqual([
			[mine.id, "Mine"],
			["wses_old", "Session wses_old"],
		]);
	});
});
