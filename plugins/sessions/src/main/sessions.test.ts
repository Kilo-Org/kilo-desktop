import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";
import { ChatOwner } from "@kilo-desktop/plugin-agent/contracts";

import manifest from "../../plugin.json";
import {
	DEFAULT_SESSION_TITLE,
	Panes,
	Sessions,
	SESSIONS_DEFINITIONS,
	type Session,
} from "../contracts";
import { chat, FakeConversations, fakeWorkspaces } from "../test/main-fakes";
import { createSessionsMainEntry } from "./entry";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "kilo-sessions-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function boot(
	options: {
		kilo?: FakeConversations;
		storage?: ReturnType<typeof createMemoryStorage>;
		originDatabase?: string;
		now?: () => number;
	} = {},
) {
	const kilo = options.kilo ?? new FakeConversations();
	const workspaces = fakeWorkspaces();
	let id = 0;
	let clock = 1_000;
	const kernel: MainKernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			kilo.registration,
			workspaces.registration,
			{
				manifest,
				definitions: SESSIONS_DEFINITIONS,
				entry: createSessionsMainEntry({
					createId: () => `wses_${++id}`,
					now: options.now ?? (() => ++clock),
					...(options.originDatabase ? { originDatabase: options.originDatabase } : {}),
				}),
			},
		],
		hostServices: () => ({
			storage: options.storage ?? createMemoryStorage("/data/kilo.sessions"),
		}),
	});
	await kernel.start();
	const sessions = kernel.kernelSdk.domains.get(Sessions)!;
	const events: string[] = [];
	sessions.on("created", ({ session }) => events.push(`created ${session.id}`));
	sessions.on("updated", ({ after }) => events.push(`updated ${after.id}`));
	sessions.on("deleted", ({ session }) => events.push(`deleted ${session.id}`));
	const list = () => sessions.getState().sessions;
	const byId = (sessionId: string) => list().find((session) => session.id === sessionId);
	return { kernel, sessions, kilo, workspaces, events, list, byId };
}

describe("work sessions", () => {
	it("creates a session that has no chat yet, in a workspace", async () => {
		const { sessions, events } = await boot();

		const created = await sessions.methods.create({ workspaceId: "w1" });

		expect(created).toMatchObject({
			id: "wses_1",
			title: DEFAULT_SESSION_TITLE,
			titleSource: "default",
			pinned: false,
			archived: false,
			workspaceId: "w1",
			chatIds: [],
		});
		expect(sessions.getState().sessions).toEqual([created]);
		expect(events).toEqual(["created wses_1"]);
	});

	it("renames, pins, archives and restores a session", async () => {
		const { sessions, byId, events } = await boot();
		const { id } = await sessions.methods.create({});

		await sessions.methods.rename({ id, title: "  Refactor auth  " });
		await sessions.methods.setPinned({ id, pinned: true });
		await sessions.methods.setArchived({ id, archived: true });
		await sessions.methods.setArchived({ id, archived: false });

		expect(byId(id)).toMatchObject({
			title: "Refactor auth",
			titleSource: "user",
			pinned: true,
			archived: false,
		});
		expect(events.filter((event) => event.startsWith("updated"))).toHaveLength(4);
	});

	it("deletes a session", async () => {
		const { sessions, list, events } = await boot();
		const { id } = await sessions.methods.create({});

		await expect(sessions.methods.remove({ id })).resolves.toEqual({ deleted: true });

		expect(list()).toEqual([]);
		expect(events.at(-1)).toBe(`deleted ${id}`);
		await expect(sessions.methods.remove({ id })).resolves.toEqual({ deleted: false });
		await expect(sessions.methods.rename({ id, title: "x" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("clears a removed workspace from its sessions", async () => {
		const { sessions, workspaces, byId } = await boot();
		const { id } = await sessions.methods.create({ workspaceId: "w1" });

		workspaces.deleted({ id: "w1", name: "App", folders: [], createdAt: 1, updatedAt: 1 });

		await vi.waitFor(() => expect(byId(id)?.workspaceId).toBeNull());
	});
});

describe("following Kilo chats", () => {
	it("adopts this app's root chats that have no session", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [
			chat("ses_a", { worktreeBranch: "kilo/fix", createdAt: 50, updatedAt: 60 }),
			chat("ses_child", { parentId: "ses_a" }),
		];

		const { list } = await boot({ kilo });

		await vi.waitFor(() => expect(list()).toHaveLength(1));
		expect(list()[0]).toMatchObject({
			title: "Chat ses_a",
			titleSource: "chat",
			workspaceId: "w1",
			worktreeBranch: "kilo/fix",
			directory: "/projects/app",
			chatIds: ["ses_a"],
			createdAt: 50,
		});
	});

	it("waits until the chats have been read, then reads them all", async () => {
		const kilo = new FakeConversations();
		kilo.ready = false;
		kilo.chats = [chat("ses_a")];
		const { list } = await boot({ kilo });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(list()).toEqual([]);

		kilo.setReady(true);

		await vi.waitFor(() => expect(list()).toHaveLength(1));
	});

	it("puts a chat created for a session into that session", async () => {
		const kilo = new FakeConversations();
		const { sessions, list, byId } = await boot({ kilo });
		const { id } = await sessions.methods.create({ workspaceId: "w1" });

		kilo.upsert(chat("ses_a", { workSessionId: id, title: "Plan the release" }));
		kilo.upsert(chat("ses_b", { workSessionId: id, title: "Second chat" }));

		await vi.waitFor(() => expect(byId(id)?.chatIds).toEqual(["ses_a", "ses_b"]));
		expect(byId(id)).toMatchObject({ title: "Plan the release", titleSource: "chat" });
		expect(list()).toHaveLength(1);
	});

	it("keeps a session's title in step with its chat until the person renames it", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a", { title: "First title" })];
		const { sessions, list, byId } = await boot({ kilo });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = list()[0]!;

		kilo.upsert(chat("ses_a", { title: "Better title" }));
		await vi.waitFor(() => expect(byId(id)?.title).toBe("Better title"));

		await sessions.methods.rename({ id, title: "Mine" });
		kilo.upsert(chat("ses_a", { title: "Ignored" }));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(byId(id)?.title).toBe("Mine");
	});

	it("archives a session when its chat is archived, unless the person decided later", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a")];
		let now = 1_000;
		const { sessions, list, byId } = await boot({ kilo, now: () => now });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = list()[0]!;

		kilo.upsert(chat("ses_a", { updatedAt: 2_000, archivedAt: 2_000 }));
		await vi.waitFor(() => expect(byId(id)?.archived).toBe(true));

		now = 3_000;
		await sessions.methods.setArchived({ id, archived: false });
		kilo.upsert(chat("ses_a", { updatedAt: 2_500, archivedAt: 2_000 }));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(byId(id)?.archived).toBe(false);
	});

	it("adopts chats created later and detaches deleted ones", async () => {
		const kilo = new FakeConversations();
		const { list } = await boot({ kilo });
		await new Promise((resolve) => setTimeout(resolve, 10));

		kilo.upsert(chat("ses_new"));
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		kilo.remove("ses_new");

		await vi.waitFor(() => expect(list()[0]?.chatIds).toEqual([]));
	});

	it("reads every chat again each time the list is read", async () => {
		const kilo = new FakeConversations();
		const { list } = await boot({ kilo });
		kilo.setReady(false);
		kilo.chats = [chat("ses_a")];

		kilo.setReady(true);

		await vi.waitFor(() => expect(list()).toHaveLength(1));
	});

	it("ignores a workspace a chat names that no longer exists", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a", { workspaceId: "w_deleted" })];
		const { sessions, list, byId } = await boot({ kilo });
		await vi.waitFor(() => expect(list()).toHaveLength(1));
		const { id } = await sessions.methods.create({});

		kilo.upsert(chat("ses_b", { workSessionId: id, workspaceId: "w_deleted" }));

		await vi.waitFor(() => expect(byId(id)?.chatIds).toEqual(["ses_b"]));
		expect(list().map((session) => session.workspaceId)).toEqual([null, null]);
	});

	it("tells kilo.agent which session holds a chat", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a")];
		const { kernel, list } = await boot({ kilo });
		await vi.waitFor(() => expect(list()).toHaveLength(1));

		const [owner] = kernel.kernelSdk.extensions.list(ChatOwner);

		expect(owner?.implementation?.sessionOf("ses_a")).toBe(list()[0]!.id);
		expect(owner?.implementation?.sessionOf("ses_other")).toBeNull();
	});
});

describe("changing chats on the server", () => {
	it("renames the session's first chat too", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a")];
		const { sessions, list } = await boot({ kilo });
		await vi.waitFor(() => expect(list()).toHaveLength(1));

		await sessions.methods.rename({ id: list()[0]!.id, title: "Mine" });

		await vi.waitFor(() => expect(kilo.renamed).toEqual([["ses_a", "Mine"]]));
	});

	it("deletes the session's chats too", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a")];
		const { sessions, list } = await boot({ kilo });
		await vi.waitFor(() => expect(list()).toHaveLength(1));

		await sessions.methods.remove({ id: list()[0]!.id });

		await vi.waitFor(() => expect(kilo.deleted).toEqual(["ses_a"]));
	});

	it("still changes the session when the server can't be reached", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a")];
		kilo.failWrites = true;
		const { sessions, list } = await boot({ kilo });
		await vi.waitFor(() => expect(list()).toHaveLength(1));

		await expect(
			sessions.methods.rename({ id: list()[0]!.id, title: "Mine" }),
		).resolves.toMatchObject({
			title: "Mine",
		});
		await expect(sessions.methods.remove({ id: list()[0]!.id })).resolves.toEqual({
			deleted: true,
		});
	});
});

describe("importing origin's sessions", () => {
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

	it("keeps origin's session ids and chat links, then titles them from their chats", async () => {
		const database = await originDatabase([{ id: "wses_old", chats: ["ses_a"] }]);
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a", { title: "Old chat" })];

		const { list } = await boot({ kilo, originDatabase: database });

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

	// Origin adopted chats from before work sessions into sessions it stamped
	// with the adoption time, so their chats were often archived earlier still.
	it("keeps a chat archived before origin gave it a session archived", async () => {
		const database = await originDatabase([
			{ id: "wses_archived", chats: ["ses_a"] },
			{ id: "wses_live", chats: ["ses_b"] },
		]);
		const kilo = new FakeConversations();
		kilo.chats = [
			chat("ses_a", { createdAt: 10, updatedAt: 30, archivedAt: 30 }),
			chat("ses_b", { createdAt: 10, updatedAt: 30 }),
		];

		const { byId } = await boot({ kilo, originDatabase: database });

		await vi.waitFor(() => expect(byId("wses_archived")?.archived).toBe(true));
		expect(byId("wses_live")?.archived).toBe(false);
	});

	it("re-archives origin's sessions a release imported as live, unless the person chose since", async () => {
		const storage = createMemoryStorage("/data/kilo.sessions");
		const imported = (id: string, chatId: string, archiveChangedAt: number): Session => ({
			id,
			title: `Chat ${chatId}`,
			titleSource: "chat",
			pinned: false,
			archived: false,
			archiveChangedAt,
			workspaceId: "w1",
			worktreeBranch: null,
			directory: "/projects/app",
			chatIds: [chatId],
			createdAt: 42,
			updatedAt: 200,
		});
		storage.saved.set("sessions", {
			sessions: [
				imported("wses_untouched", "ses_a", 42),
				imported("wses_restored", "ses_b", 5_000),
			],
			importedFromOrigin: true,
			legacyPinsImported: true,
			pendingPinnedChatIds: [],
		});
		const kilo = new FakeConversations();
		kilo.chats = [
			chat("ses_a", { createdAt: 10, updatedAt: 30, archivedAt: 30 }),
			chat("ses_b", { createdAt: 10, updatedAt: 30, archivedAt: 30 }),
		];

		const { byId } = await boot({ storage, kilo });

		await vi.waitFor(() => expect(byId("wses_untouched")?.archived).toBe(true));
		expect(byId("wses_restored")?.archived).toBe(false);
	});

	it("imports once, never overwrites, and starts empty without a readable database", async () => {
		const storage = createMemoryStorage("/data/kilo.sessions");
		const database = await originDatabase([{ id: "wses_old", chats: [] }]);
		const first = await boot({ storage, originDatabase: database });
		await vi.waitFor(() => expect(first.list()).toHaveLength(1));
		await first.sessions.methods.remove({ id: "wses_old" });

		const second = await boot({ storage, originDatabase: database });
		const garbage = path.join(root, "garbage.db");
		await writeFile(garbage, "not a database");
		const unreadable = await boot({ originDatabase: garbage });
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(second.list()).toEqual([]);
		expect(unreadable.list()).toEqual([]);
	});

	it("puts each chat in exactly one session when origin is read a launch after a failed read", async () => {
		const storage = createMemoryStorage("/data/kilo.sessions");
		const file = path.join(root, "data.db");
		await mkdir(file); // A folder can't be opened as a database: the read fails.
		const chats = () => {
			const kilo = new FakeConversations();
			kilo.chats = [chat("ses_a", { title: "Old chat" }), chat("ses_b"), chat("ses_new")];
			return kilo;
		};
		const first = await boot({ storage, kilo: chats(), originDatabase: file });
		await vi.waitFor(() => expect(first.list()).toHaveLength(3));
		await rm(file, { recursive: true });
		await originDatabase([{ id: "wses_old", chats: ["ses_a", "ses_b"] }]);

		const second = await boot({ storage, kilo: chats(), originDatabase: file });

		await vi.waitFor(() =>
			expect(second.byId("wses_old")).toMatchObject({
				title: "Old chat",
				chatIds: ["ses_a", "ses_b"],
			}),
		);
		const owners = (chatId: string) =>
			second.list().filter((session) => session.chatIds.includes(chatId));
		expect(owners("ses_a")).toHaveLength(1);
		expect(owners("ses_b")).toHaveLength(1);
		expect(owners("ses_new")).toHaveLength(1);
		expect(second.list()).toHaveLength(2);
	});

	it("keeps a person's choices on a chat adopted before origin's session was read", async () => {
		const storage = createMemoryStorage("/data/kilo.sessions");
		const file = path.join(root, "data.db");
		await mkdir(file);
		const chats = () => {
			const kilo = new FakeConversations();
			kilo.chats = [chat("ses_a")];
			return kilo;
		};
		const first = await boot({ storage, kilo: chats(), originDatabase: file });
		await vi.waitFor(() => expect(first.list()).toHaveLength(1));
		const adopted = first.list()[0]!;
		await first.sessions.methods.rename({ id: adopted.id, title: "Mine" });
		await first.sessions.methods.setPinned({ id: adopted.id, pinned: true });
		await rm(file, { recursive: true });
		await originDatabase([{ id: "wses_old", chats: ["ses_a"] }]);

		const second = await boot({ storage, kilo: chats(), originDatabase: file });

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

	it("applies origin's pins and panes only once origin's sessions are read", async () => {
		const storage = createMemoryStorage("/data/kilo.sessions");
		const file = path.join(root, "data.db");
		await mkdir(file);
		const legacyPanes = {
			state: {
				bySessionId: {
					wses_old: {
						tabs: [
							{ instanceId: "t1", definitionId: "terminal.terminal", title: "Shell", ordinal: 1 },
						],
						layoutJson: '{"groups":[]}',
					},
				},
			},
		};
		const handOver = async (kernel: MainKernel) => {
			const own = kernel.sdkFor("kilo.sessions").domains;
			await own.get(Sessions)!.methods.importLegacyPins({ ids: ["wses_old"] });
			await own.get(Panes)!.methods.importLegacy({ state: legacyPanes });
		};
		const first = await boot({ storage, originDatabase: file });
		await handOver(first.kernel);
		await rm(file, { recursive: true });
		await originDatabase([{ id: "wses_old", chats: [] }]);

		const second = await boot({ storage, originDatabase: file });
		await handOver(second.kernel);

		expect(second.byId("wses_old")?.pinned).toBe(true);
		const panes = second.kernel.kernelSdk.domains.get(Panes)!.getState().bySession.wses_old;
		expect(panes?.layout).toBe('{"groups":[]}');
		expect(panes?.panes.map((pane) => pane.id)).toContain("t1");
	});

	it("counts a file that isn't a database as imported", async () => {
		const storage = createMemoryStorage("/data/kilo.sessions");
		const file = path.join(root, "data.db");
		await writeFile(file, "not a database");
		await boot({ storage, originDatabase: file });
		await new Promise((resolve) => setTimeout(resolve, 30));
		await rm(file);
		await originDatabase([{ id: "wses_old", chats: [] }]);

		const second = await boot({ storage, originDatabase: file });
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(second.list()).toEqual([]);
	});

	it("takes over pins saved under session or chat ids", async () => {
		const kilo = new FakeConversations();
		kilo.chats = [chat("ses_a"), chat("ses_b")];
		const { kernel, sessions, list } = await boot({ kilo });
		const own = await sessions.methods.create({});
		await vi.waitFor(() => expect(list()).toHaveLength(3));
		const ownUi = kernel.sdkFor("kilo.sessions").domains.get(Sessions)!;

		await ownUi.methods.importLegacyPins({ ids: [own.id, "ses_b", "ses_gone"] });
		await ownUi.methods.importLegacyPins({ ids: ["ses_a"] });

		const pinned = (session: Session | undefined) => session?.pinned;
		expect(pinned(list().find((s) => s.id === own.id))).toBe(true);
		expect(pinned(list().find((s) => s.chatIds.includes("ses_b")))).toBe(true);
		expect(pinned(list().find((s) => s.chatIds.includes("ses_a")))).toBe(false);
		await expect(sessions.methods.importLegacyPins({ ids: [] })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
	});
});
