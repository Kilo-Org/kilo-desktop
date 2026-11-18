import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationContent } from "@kilo-desktop/plugin-shell/contracts";

import type { WorkSession } from "../../contracts";
import {
	bootWorkSessions,
	chat,
	FakeCore,
	fakeShell,
	storageWithWorkspaces,
	type BootOptions,
} from "../test-boot";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "kilo-work-sessions-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function boot(options: BootOptions & { originDatabase?: string } = {}) {
	const { originDatabase, ...rest } = options;
	let id = 0;
	let clock = 1_000;
	const booted = await bootWorkSessions({
		...rest,
		options: {
			workSessions: () => ({
				createId: () => `wses_${++id}`,
				now: options.now ?? (() => ++clock),
				...(originDatabase ? { originDatabase } : {}),
			}),
			...rest.options,
		},
	});
	const events: string[] = [];
	booted.workSessions.on("created", ({ workSession }) => events.push(`created ${workSession.id}`));
	booted.workSessions.on("updated", ({ after }) => events.push(`updated ${after.id}`));
	booted.workSessions.on("deleted", ({ workSession }) => events.push(`deleted ${workSession.id}`));
	return { ...booted, events, core: booted.core! };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("work sessions", () => {
	it("creates a work session that has no chat yet, in a workspace, titled as Kilo titles a new chat", async () => {
		const createdAt = Date.UTC(2026, 10, 4, 22, 44, 38, 327);
		const { workSessions, events } = await boot({ now: () => createdAt });

		const created = await workSessions.methods.create({ workspaceId: "w1" });

		expect(created).toMatchObject({
			id: "wses_1",
			title: "New session - 2026-11-04T22:44:38.327Z",
			titleSource: "default",
			pinned: false,
			archived: false,
			workspaceId: "w1",
			branch: null,
			chatIds: [],
		});
		expect(workSessions.getState().workSessions).toEqual([created]);
		expect(workSessions.lookup(created.id)).toEqual(created);
		expect(events).toEqual(["created wses_1"]);
	});

	it("renames, pins, archives and restores a work session", async () => {
		const { workSessions, byId, events } = await boot();
		const { id } = await workSessions.methods.create({});

		await workSessions.methods.rename({ id, title: "  Refactor auth  " });
		await workSessions.methods.setPinned({ id, pinned: true });
		await workSessions.methods.setArchived({ id, archived: true });
		await workSessions.methods.setArchived({ id, archived: false });

		expect(byId(id)).toMatchObject({
			title: "Refactor auth",
			titleSource: "user",
			pinned: true,
			archived: false,
		});
		expect(events.filter((event) => event.startsWith("updated"))).toHaveLength(4);
	});

	it("keeps a title given at creation", async () => {
		const { workSessions } = await boot();

		await expect(workSessions.methods.create({ title: " Mine " })).resolves.toMatchObject({
			title: "Mine",
			titleSource: "user",
		});
	});

	it("deletes a work session", async () => {
		const { workSessions, list, events } = await boot();
		const { id } = await workSessions.methods.create({});

		await expect(workSessions.methods.remove({ id })).resolves.toEqual({ deleted: true });

		expect(list()).toEqual([]);
		expect(events.at(-1)).toBe(`deleted ${id}`);
		await expect(workSessions.methods.remove({ id })).resolves.toEqual({ deleted: false });
		await expect(workSessions.methods.rename({ id, title: "x" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("clears a removed workspace from its work sessions", async () => {
		const { workSessions, workspaces, byId } = await boot();
		const { id } = await workSessions.methods.create({ workspaceId: "w1" });

		await workspaces.methods.remove({ id: "w1" });

		await vi.waitFor(() => expect(byId(id)?.workspaceId).toBeNull());
	});

	it("works without kilo.core: no chats, and creating one says why", async () => {
		const errors: unknown[] = [];
		const { workSessions } = await boot({
			core: false,
			logger: {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: (...args) => errors.push(args),
			},
		});
		const { id } = await workSessions.methods.create({});

		await expect(workSessions.methods.createChat({ id })).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		await expect(workSessions.methods.rename({ id, title: "Mine" })).resolves.toMatchObject({
			title: "Mine",
		});
		await expect(workSessions.methods.remove({ id })).resolves.toEqual({ deleted: true });
		expect(errors).toEqual([]);
	});
});

describe("creating chats", () => {
	it("creates a Kilo chat stamped with the work session, its workspace, folders and branch", async () => {
		const { workSessions, core, byId } = await boot();
		const { id } = await workSessions.methods.create({ workspaceId: "w1" });

		const created = await workSessions.methods.createChat({
			id,
			agent: "code",
			model: { aiProviderId: "kilo", modelId: "auto" },
			title: "Plan",
		});

		expect(core.created).toEqual([
			{
				workSessionId: id,
				directory: "/projects/app",
				workspaceId: "w1",
				workspaceFolders: [
					{ path: "/projects/lib", isPrimary: false },
					{ path: "/projects/app", isPrimary: true },
				],
				agent: "code",
				model: { aiProviderId: "kilo", modelId: "auto" },
				title: "Plan",
			},
		]);
		await vi.waitFor(() => expect(byId(id)?.chatIds).toEqual([created.id]));
	});

	it("creates a chat in a work session without a workspace in kilo.core's own folder", async () => {
		const { workSessions, core } = await boot();
		const { id } = await workSessions.methods.create({});

		await workSessions.methods.createChat({ id });

		expect(core.created).toEqual([{ workSessionId: id }]);
		await expect(workSessions.methods.createChat({ id: "wses_gone" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("forking chats", () => {
	it("forks one of its chats and lists the fork as soon as it returns", async () => {
		const { workSessions, core, byId } = await boot();
		const { id } = await workSessions.methods.create({ workspaceId: "w1" });
		const source = await workSessions.methods.createChat({ id });
		await vi.waitFor(() => expect(byId(id)?.chatIds).toEqual([source.id]));

		const fork = await workSessions.methods.forkChat({
			id,
			chatId: source.id,
			messageId: "msg_2",
		});

		expect(core.forked).toEqual([{ id: source.id, messageId: "msg_2" }]);
		expect(fork.workSessionId).toBe(id);
		expect(byId(id)?.chatIds).toEqual([source.id, fork.id]);
	});

	it("refuses a chat that isn't in the work session, without forking it", async () => {
		const { workSessions, core } = await boot();
		const { id } = await workSessions.methods.create({ workspaceId: "w1" });

		await expect(
			workSessions.methods.forkChat({ id, chatId: "ses_elsewhere", messageId: "msg_2" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(core.forked).toEqual([]);
	});
});

describe("following Kilo chats", () => {
	it("adopts this app's root chats that have no work session", async () => {
		const core = new FakeCore();
		core.chats = [
			chat("ses_a", { worktreeBranch: "kilo/fix", createdAt: 50, updatedAt: 60 }),
			chat("ses_child", { parentId: "ses_a" }),
		];

		const { list } = await boot({ core });

		await vi.waitFor(() => expect(list()).toHaveLength(1));
		expect(list()[0]).toMatchObject({
			title: "Chat ses_a",
			titleSource: "chat",
			workspaceId: "w1",
			branch: "kilo/fix",
			directory: "/projects/app",
			chatIds: ["ses_a"],
			createdAt: 50,
		});
	});

	it("keeps the work session a chat is stamped with when this app doesn't know it, so its siblings join", async () => {
		const core = new FakeCore();
		core.chats = [
			chat("ses_a", { workSessionId: "wses_elsewhere", createdAt: 10 }),
			chat("ses_b", { workSessionId: "wses_elsewhere", createdAt: 20 }),
		];

		const { list } = await boot({ core });

		await vi.waitFor(() =>
			expect(list()).toEqual([
				expect.objectContaining({ id: "wses_elsewhere", chatIds: ["ses_a", "ses_b"] }),
			]),
		);
	});

	it("waits until the chats have been read, then reads them all", async () => {
		const core = new FakeCore();
		core.ready = false;
		core.chats = [chat("ses_a")];
		const { list } = await boot({ core });
		await settle();
		expect(list()).toEqual([]);

		core.setReady(true);

		await vi.waitFor(() => expect(list()).toHaveLength(1));
	});

	it("puts a chat created for a work session into that work session", async () => {
		const { workSessions, core, list, byId } = await boot();
		const { id } = await workSessions.methods.create({ workspaceId: "w1" });

		core.upsert(chat("ses_a", { workSessionId: id, title: "Plan the release" }));
		core.upsert(chat("ses_b", { workSessionId: id, title: "Second chat" }));

		await vi.waitFor(() => expect(byId(id)?.chatIds).toEqual(["ses_a", "ses_b"]));
		expect(byId(id)).toMatchObject({ title: "Plan the release", titleSource: "chat" });
		expect(list()).toHaveLength(1);
	});

	it("keeps a work session's title in step with its chat until the person renames it", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a", { title: "First title" })];
		const { workSessions, list, byId } = await boot({ core });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = list()[0]!;

		core.upsert(chat("ses_a", { title: "Better title" }));
		await vi.waitFor(() => expect(byId(id)?.title).toBe("Better title"));

		await workSessions.methods.rename({ id, title: "Mine" });
		core.upsert(chat("ses_a", { title: "Ignored" }));
		await settle();
		expect(byId(id)?.title).toBe("Mine");
	});

	it("follows its chat's directory, branch and workspace while not placed at creation", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a", { workspaceId: null })];
		const { list, byId } = await boot({ core });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = list()[0]!;

		core.upsert(
			chat("ses_a", {
				directory: "/projects/app/.kilo/worktrees/x",
				worktreeBranch: "kilo/x",
				updatedAt: 900,
			}),
		);

		await vi.waitFor(() =>
			expect(byId(id)).toMatchObject({
				directory: "/projects/app/.kilo/worktrees/x",
				branch: "kilo/x",
				workspaceId: "w1",
				updatedAt: 900,
			}),
		);
	});

	it("archives a work session when its chat is archived, unless the person decided later", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a")];
		let now = 1_000;
		const { workSessions, list, byId } = await boot({ core, now: () => now });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = list()[0]!;

		core.upsert(chat("ses_a", { updatedAt: 2_000, archivedAt: 2_000 }));
		await vi.waitFor(() => expect(byId(id)?.archived).toBe(true));

		now = 3_000;
		await workSessions.methods.setArchived({ id, archived: false });
		core.upsert(chat("ses_a", { updatedAt: 2_500, archivedAt: 2_000 }));
		await settle();
		expect(byId(id)?.archived).toBe(false);
	});

	it("adopts chats created later and detaches deleted ones", async () => {
		const { core, list } = await boot();
		await settle();

		core.upsert(chat("ses_new"));
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		core.remove("ses_new");

		await vi.waitFor(() => expect(list()[0]?.chatIds).toEqual([]));
	});

	it("reads every chat again each time the list is read", async () => {
		const { core, list } = await boot();
		core.setReady(false);
		core.chats = [chat("ses_a")];

		core.setReady(true);

		await vi.waitFor(() => expect(list()).toHaveLength(1));
	});

	it("ignores a workspace a chat names that no longer exists", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a", { workspaceId: "w_deleted" })];
		const { workSessions, list, byId } = await boot({ core });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = await workSessions.methods.create({});

		core.upsert(chat("ses_b", { workSessionId: id, workspaceId: "w_deleted" }));

		await vi.waitFor(() => expect(byId(id)?.chatIds).toEqual(["ses_b"]));
		expect(list().map((workSession) => workSession.workspaceId)).toEqual([null, null]);
	});
});

describe("changing chats on the server", () => {
	it("renames the work session's first chat too", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a")];
		const { workSessions, list } = await boot({ core });
		await vi.waitFor(() => expect(list()).toHaveLength(1));

		await workSessions.methods.rename({ id: list()[0]!.id, title: "Mine" });

		await vi.waitFor(() => expect(core.renamed).toEqual([["ses_a", "Mine"]]));
	});

	it("deletes the work session's chats too", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a")];
		const { workSessions, list } = await boot({ core });
		await vi.waitFor(() => expect(list()).toHaveLength(1));

		await workSessions.methods.remove({ id: list()[0]!.id });

		await vi.waitFor(() => expect(core.deleted).toEqual(["ses_a"]));
	});

	it("keeps a deleted work session gone when its busy chat changes before the server deletes it", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a", { title: "Busy" })];
		const { workSessions, list } = await boot({ core });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = list()[0]!;

		const removed = workSessions.methods.remove({ id });
		// The chat is still running: kilo.core announces a change before the delete lands.
		core.upsert(chat("ses_a", { title: "Busy", workSessionId: id, updatedAt: 9_000 }));
		await removed;
		core.remove("ses_a");
		await settle();

		expect(list()).toEqual([]);
	});

	it("keeps a deleted work session gone when a chat created for it arrives afterwards", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a")];
		const { workSessions, list } = await boot({ core });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = list()[0]!;

		await workSessions.methods.remove({ id });
		// Created mid-delete (or from another window), so the delete never knew it.
		core.upsert(chat("ses_late", { workSessionId: id }));
		await settle();

		expect(list()).toEqual([]);
	});

	it("still changes the work session when the server can't be reached", async () => {
		const core = new FakeCore();
		core.chats = [chat("ses_a")];
		core.failWrites = true;
		const { workSessions, list } = await boot({ core });
		await vi.waitFor(() => expect(list()).toHaveLength(1));

		await expect(
			workSessions.methods.rename({ id: list()[0]!.id, title: "Mine" }),
		).resolves.toMatchObject({ title: "Mine" });
		await expect(workSessions.methods.remove({ id: list()[0]!.id })).resolves.toEqual({
			deleted: true,
		});
	});
});

describe("importing origin's work sessions", () => {
	async function originDatabase(sessions: { id: string; chats: string[] }[]) {
		const file = path.join(root, "data.db");
		const db = new Database(file);
		db.exec(`
			CREATE TABLE sessions (id text PRIMARY KEY, created_at integer NOT NULL);
			CREATE TABLE session_chats (kilo_session_id text PRIMARY KEY, session_id text NOT NULL,
				created_at integer NOT NULL);
		`);
		for (const session of sessions) {
			db.prepare("INSERT INTO sessions VALUES (?, 42)").run(session.id);
			session.chats.forEach((chatId, index) =>
				db
					.prepare("INSERT INTO session_chats VALUES (?, ?, ?)")
					.run(chatId, session.id, 50 + index),
			);
		}
		db.close();
		return file;
	}

	const withChats = (...chats: ReturnType<typeof chat>[]) => {
		const core = new FakeCore();
		core.chats = chats;
		return core;
	};

	it("keeps origin's work session ids and chat links, then titles them from their chats", async () => {
		const database = await originDatabase([{ id: "wses_old", chats: ["ses_a"] }]);

		const { list } = await boot({
			core: withChats(chat("ses_a", { title: "Old chat" })),
			originDatabase: database,
		});

		await vi.waitFor(() =>
			expect(list()).toEqual([
				expect.objectContaining({
					id: "wses_old",
					title: "Old chat",
					chatIds: ["ses_a"],
					createdAt: 42,
				}),
			]),
		);
	});

	// kilo.chat gives a work session made from chats its agent pane when it is created.
	it("announces origin's work sessions as created", async () => {
		const database = await originDatabase([
			{ id: "wses_old", chats: ["ses_a"] },
			{ id: "wses_older", chats: ["ses_b"] },
		]);

		// Held until `boot` has subscribed to the events.
		let release!: () => void;
		const opened = new Promise<void>((resolve) => (release = resolve));
		const { events, list } = await boot({
			core: withChats(chat("ses_a"), chat("ses_b")),
			options: {
				workSessions: () => ({
					originDatabase: database,
					loadSqlite: async () => {
						await opened;
						return Database;
					},
				}),
			},
		});
		release();

		await vi.waitFor(() => expect(list()).toHaveLength(2));
		expect(events).toEqual(expect.arrayContaining(["created wses_old", "created wses_older"]));
	});

	// Origin adopted chats from before work sessions into sessions it stamped
	// with the adoption time, so their chats were often archived earlier still.
	it("keeps a chat archived before origin gave it a work session archived", async () => {
		const database = await originDatabase([
			{ id: "wses_archived", chats: ["ses_a"] },
			{ id: "wses_live", chats: ["ses_b"] },
		]);

		const { byId } = await boot({
			core: withChats(
				chat("ses_a", { createdAt: 10, updatedAt: 30, archivedAt: 30 }),
				chat("ses_b", { createdAt: 10, updatedAt: 30 }),
			),
			originDatabase: database,
		});

		await vi.waitFor(() => expect(byId("wses_archived")?.archived).toBe(true));
		expect(byId("wses_live")?.archived).toBe(false);
	});

	it("re-archives origin's work sessions a release imported as live, unless the person chose since", async () => {
		const storage = storageWithWorkspaces();
		const imported = (id: string, chatId: string, archiveChangedAt: number): WorkSession => ({
			id,
			title: `Chat ${chatId}`,
			titleSource: "chat",
			pinned: false,
			archived: false,
			archiveChangedAt,
			workspaceId: "w1",
			branch: null,
			directory: "/projects/app",
			chatIds: [chatId],
			createdAt: 42,
			updatedAt: 200,
		});
		storage.saved.set("work-sessions", {
			workSessions: [
				imported("wses_untouched", "ses_a", 42),
				imported("wses_restored", "ses_b", 5_000),
			],
			importedFromOrigin: true,
		});

		const { byId } = await boot({
			storage,
			core: withChats(
				chat("ses_a", { createdAt: 10, updatedAt: 30, archivedAt: 30 }),
				chat("ses_b", { createdAt: 10, updatedAt: 30, archivedAt: 30 }),
			),
		});

		await vi.waitFor(() => expect(byId("wses_untouched")?.archived).toBe(true));
		expect(byId("wses_restored")?.archived).toBe(false);
	});

	it("imports once, never overwrites, and starts empty without a readable database", async () => {
		const storage = storageWithWorkspaces();
		const database = await originDatabase([{ id: "wses_old", chats: [] }]);
		const first = await boot({ storage, originDatabase: database });
		await vi.waitFor(() => expect(first.list()).toHaveLength(1));
		await first.workSessions.methods.remove({ id: "wses_old" });

		const second = await boot({ storage, originDatabase: database });
		const garbage = path.join(root, "garbage.db");
		await writeFile(garbage, "not a database");
		const unreadable = await boot({ originDatabase: garbage });
		await settle();

		expect(second.list()).toEqual([]);
		expect(unreadable.list()).toEqual([]);
	});

	it("retries next launch when better-sqlite3 can't load, and tells the person", async () => {
		const storage = storageWithWorkspaces();
		const database = await originDatabase([{ id: "wses_old", chats: [] }]);
		const warnings: string[] = [];
		const notices = new Map<string, NotificationContent>();

		const { list, kernel } = await boot({
			storage,
			plugins: [fakeShell(notices)],
			originDatabase: database,
			logger: {
				debug: () => {},
				info: () => {},
				warn: (message) => warnings.push(message),
				error: (message) => warnings.push(`error: ${message}`),
			},
			options: {
				workSessions: () => ({
					originDatabase: database,
					loadSqlite: async () => {
						throw new Error("Cannot find module 'better-sqlite3'");
					},
				}),
			},
		});
		await vi.waitFor(() => expect(notices.get("origin-import-failed")?.level).toBe("warning"));

		expect(kernel.pluginState("kilo.work-sessions")).toBe("active");
		expect(list()).toEqual([]);
		expect(storage.saved.get("work-sessions")).not.toMatchObject({ importedFromOrigin: true });
		expect(warnings.filter((warning) => warning.includes("better-sqlite3"))).toHaveLength(1);
		expect(warnings.filter((warning) => warning.startsWith("error"))).toEqual([]);

		const relaunched = await boot({ storage, originDatabase: database });

		await vi.waitFor(() => expect(relaunched.byId("wses_old")).toBeDefined());
	});

	describe("for a person a release marked imported without reading origin", () => {
		const saved = (id: string, chatIds: string[], overrides: Partial<WorkSession> = {}) => ({
			id,
			title: `Chat ${chatIds[0] ?? id}`,
			titleSource: "chat" as const,
			pinned: false,
			archived: false,
			archiveChangedAt: 100,
			workspaceId: null,
			branch: null,
			directory: "/projects/app",
			chatIds,
			createdAt: 100,
			updatedAt: 200,
			...overrides,
		});
		const markedImported = (workSessions: WorkSession[]) => {
			const storage = storageWithWorkspaces();
			storage.saved.set("work-sessions", {
				workSessions,
				importedFromOrigin: true,
				originArchivesReopened: true,
			});
			return storage;
		};

		it("brings origin's work sessions over once, folding the chats adopted meanwhile", async () => {
			const storage = markedImported([
				saved("wses_adopted", ["ses_a"], { title: "Mine", titleSource: "user" }),
			]);
			const database = await originDatabase([{ id: "wses_old", chats: ["ses_a", "ses_b"] }]);

			const first = await boot({
				storage,
				core: withChats(chat("ses_a"), chat("ses_b")),
				originDatabase: database,
			});

			await vi.waitFor(() =>
				expect(first.list()).toEqual([
					expect.objectContaining({ id: "wses_old", title: "Mine", chatIds: ["ses_a", "ses_b"] }),
				]),
			);
			await first.workSessions.methods.remove({ id: "wses_old" });

			const second = await boot({ storage, core: withChats(), originDatabase: database });
			await settle();

			expect(second.list()).toEqual([]);
		});

		it("leaves them alone when some of origin's work sessions are already here", async () => {
			const storage = markedImported([saved("wses_kept", ["ses_a"])]);
			const database = await originDatabase([
				{ id: "wses_kept", chats: ["ses_a"] },
				{ id: "wses_deleted", chats: ["ses_b"] },
			]);

			const { list } = await boot({
				storage,
				core: withChats(chat("ses_a")),
				originDatabase: database,
			});
			await vi.waitFor(() =>
				expect(storage.saved.get("work-sessions")).toMatchObject({ originImportVerified: true }),
			);

			expect(list().map((workSession) => workSession.id)).toEqual(["wses_kept"]);
		});
	});

	it("puts each chat in exactly one work session when origin is read a launch after a failed read", async () => {
		const storage = storageWithWorkspaces();
		const file = path.join(root, "data.db");
		await mkdir(file); // A folder can't be opened as a database: the read fails.
		const chats = () =>
			withChats(chat("ses_a", { title: "Old chat" }), chat("ses_b"), chat("ses_new"));
		const first = await boot({ storage, core: chats(), originDatabase: file });
		await vi.waitFor(() => expect(first.list()).toHaveLength(3));
		await rm(file, { recursive: true });
		await originDatabase([{ id: "wses_old", chats: ["ses_a", "ses_b"] }]);

		const second = await boot({ storage, core: chats(), originDatabase: file });

		await vi.waitFor(() =>
			expect(second.byId("wses_old")).toMatchObject({
				title: "Old chat",
				chatIds: ["ses_a", "ses_b"],
			}),
		);
		const owners = (chatId: string) =>
			second.list().filter((workSession) => workSession.chatIds.includes(chatId));
		expect(owners("ses_a")).toHaveLength(1);
		expect(owners("ses_b")).toHaveLength(1);
		expect(owners("ses_new")).toHaveLength(1);
		expect(second.list()).toHaveLength(2);
	});

	it("keeps a person's choices on a chat adopted before origin's work session was read", async () => {
		const storage = storageWithWorkspaces();
		const file = path.join(root, "data.db");
		await mkdir(file);
		const first = await boot({ storage, core: withChats(chat("ses_a")), originDatabase: file });
		await vi.waitFor(() => expect(first.list()).toHaveLength(1));
		const adopted = first.list()[0]!;
		await first.workSessions.methods.rename({ id: adopted.id, title: "Mine" });
		await first.workSessions.methods.setPinned({ id: adopted.id, pinned: true });
		await rm(file, { recursive: true });
		await originDatabase([{ id: "wses_old", chats: ["ses_a"] }]);

		const second = await boot({ storage, core: withChats(chat("ses_a")), originDatabase: file });

		await vi.waitFor(() =>
			expect(second.list()).toEqual([
				expect.objectContaining({
					id: "wses_old",
					title: "Mine",
					titleSource: "user",
					pinned: true,
					chatIds: ["ses_a"],
				}),
			]),
		);
	});

	it("counts a file that isn't a database as imported", async () => {
		const storage = storageWithWorkspaces();
		const file = path.join(root, "data.db");
		await writeFile(file, "not a database");
		await boot({ storage, originDatabase: file });
		await settle();
		await rm(file);
		await originDatabase([{ id: "wses_old", chats: [] }]);

		const second = await boot({ storage, originDatabase: file });
		await settle();

		expect(second.list()).toEqual([]);
	});
});
