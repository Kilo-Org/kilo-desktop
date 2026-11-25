import { describe, expect, it } from "vitest";

import type { ChatSummary } from "../../../contracts";
import {
	applyHydratedStatus,
	applyKiloEvent,
	chatsAwaitingLineage,
	diffChats,
	IDLE,
	lineageOf,
	publishChats,
	resetActivity,
	type ChatActivityState,
	type ChatInfo,
	type ChatRecords,
	type KiloEvent,
} from "./activity";

const NOW = 1_700_000_000_000;
const desktop = (extra: Record<string, unknown> = {}) => ({ "kilo-desktop": { ...extra } });

function info(id: string, overrides: Partial<ChatInfo> = {}): ChatInfo {
	return {
		id,
		title: `Chat ${id}`,
		parentId: null,
		directory: "/repo",
		metadata: desktop({ workspaceId: "w1" }),
		createdAt: 10,
		updatedAt: 20,
		...overrides,
	};
}

function records(
	entries: Record<string, { info?: ChatInfo; activity?: Partial<ChatActivityState> }>,
): ChatRecords {
	return Object.fromEntries(
		Object.entries(entries).map(([id, record]) => [
			id,
			{
				...(record.info ? { info: record.info } : {}),
				activity: { ...IDLE, ...record.activity },
			},
		]),
	);
}

const apply = (chats: ChatRecords, event: KiloEvent, now = NOW) =>
	applyKiloEvent(chats, event, now);
const event = (
	type: string,
	data: Record<string, unknown>,
	extra: { created?: number; directory?: string } = {},
): KiloEvent => ({ type, data, ...extra });
const execution = (sessionID: string, outcome: string, extra: Record<string, unknown> = {}) =>
	event(`session.execution.${outcome}`, { sessionID, ...extra });

describe("applying Kilo events", () => {
	it("tracks pending permissions by id and ignores duplicates", () => {
		const asked = event("permission.asked", { id: "perm-1", sessionID: "ses-1" });
		const first = apply({}, asked);
		expect(first["ses-1"]?.activity.pendingPermissionIds).toEqual(["perm-1"]);
		expect(apply(first, asked)).toBe(first);

		const replied = apply(
			first,
			event("permission.replied", { sessionID: "ses-1", requestID: "perm-1", reply: "once" }),
		);
		expect(replied["ses-1"]?.activity.pendingPermissionIds).toEqual([]);
	});

	it("tracks the question tool's forms across created, replied and cancelled", () => {
		const form = (id: string, kind?: string) =>
			event("form.created", {
				form: { id, sessionID: "ses-1", title: "Q", ...(kind ? { metadata: { kind } } : {}) },
			});
		let chats = apply({}, form("frm-1", "question"));
		chats = apply(chats, form("frm-2", "question"));
		expect(apply(chats, form("frm-3"))).toBe(chats);
		expect(chats["ses-1"]?.activity.pendingQuestionIds).toEqual(["frm-1", "frm-2"]);

		chats = apply(chats, event("form.replied", { id: "frm-1", sessionID: "ses-1", answer: {} }));
		chats = apply(chats, event("form.cancelled", { id: "frm-2", sessionID: "ses-1" }));
		expect(chats["ses-1"]?.activity.pendingQuestionIds).toEqual([]);
	});

	it("stamps workingSince when an execution starts, keeping it through a retry", () => {
		const busy = apply({}, execution("ses-1", "started"));
		const retry = apply(
			busy,
			event("session.retry.scheduled", { sessionID: "ses-1", attempt: 1 }),
			NOW + 5000,
		);
		const stepped = apply(retry, event("session.step.started", { sessionID: "ses-1" }), NOW + 9000);

		expect(busy["ses-1"]?.activity).toMatchObject({ status: "busy", workingSince: NOW });
		expect(retry["ses-1"]?.activity).toMatchObject({ status: "retry", workingSince: NOW });
		expect(stepped["ses-1"]?.activity).toMatchObject({ status: "busy", workingSince: NOW });
		expect(apply(busy, event("session.step.started", { sessionID: "ses-1" }))).toBe(busy);
	});

	it("stamps completedAt when the execution ends and clears workingSince", () => {
		const busy = records({ "ses-1": { activity: { status: "busy", workingSince: NOW - 3000 } } });

		for (const outcome of ["succeeded", "interrupted"]) {
			expect(apply(busy, execution("ses-1", outcome))["ses-1"]?.activity).toEqual({
				...IDLE,
				completedAt: NOW,
			});
		}
	});

	it("ignores an end for unknown or already idle chats", () => {
		const idle = records({ "ses-1": {} });

		expect(apply({}, execution("ses-1", "succeeded"))).toEqual({});
		expect(apply(idle, execution("ses-1", "interrupted"))).toBe(idle);
	});

	it("keeps a failed turn's error until the next turn starts, but an interruption has none", () => {
		let chats = apply({}, execution("ses-1", "started"));
		chats = apply(
			chats,
			execution("ses-1", "failed", { error: { type: "provider", message: "Rate limited" } }),
		);
		expect(chats["ses-1"]?.activity).toMatchObject({
			status: "idle",
			completedAt: NOW,
			lastError: { name: "provider", message: "Rate limited" },
		});
		expect(
			apply(chats, execution("ses-1", "started"))["ses-1"]?.activity.lastError,
		).toBeUndefined();

		const stopped = apply(
			apply({}, execution("ses-1", "started")),
			execution("ses-1", "interrupted"),
		);
		expect(stopped["ses-1"]?.activity.lastError).toBeUndefined();
	});

	it("records a created chat, stamped with the event's time, and where events came from", () => {
		const created = apply(
			{},
			event(
				"session.created",
				{
					sessionID: "ses-1",
					title: "Fix login",
					location: { directory: "/repo/project" },
					parentID: "ses-0",
					metadata: desktop({ workspaceId: "ws-1" }),
				},
				{ created: NOW - 100, directory: "/repo/project" },
			),
		);

		expect(created["ses-1"]).toEqual({
			info: {
				id: "ses-1",
				title: "Fix login",
				parentId: "ses-0",
				directory: "/repo/project",
				metadata: desktop({ workspaceId: "ws-1" }),
				createdAt: NOW - 100,
				updatedAt: NOW - 100,
			},
			activity: IDLE,
			directory: "/repo/project",
		});
	});

	it("follows renames, metadata, archiving and moves of known chats", () => {
		const chats = records({ "ses-1": { info: info("ses-1") } });

		const renamed = apply(
			chats,
			event("session.renamed", { sessionID: "ses-1", title: "New" }, { created: 50 }),
		);
		expect(renamed["ses-1"]?.info).toMatchObject({ title: "New", updatedAt: 50 });
		const restamped = apply(
			renamed,
			event("session.metadata.updated", {
				sessionID: "ses-1",
				metadata: desktop({ workspaceId: "w2" }),
			}),
		);
		expect(restamped["ses-1"]?.info?.metadata).toEqual(desktop({ workspaceId: "w2" }));
		const archived = apply(
			restamped,
			event("session.archived", { sessionID: "ses-1" }, { created: 60 }),
		);
		expect(archived["ses-1"]?.info?.archivedAt).toBe(60);
		const restored = apply(archived, event("session.unarchived", { sessionID: "ses-1" }));
		expect(restored["ses-1"]?.info).not.toHaveProperty("archivedAt");
		const moved = apply(
			restored,
			event(
				"session.moved",
				{ sessionID: "ses-1", location: { directory: "/elsewhere" } },
				{ directory: "/repo" },
			),
		);
		expect(moved["ses-1"]).toMatchObject({
			info: { directory: "/elsewhere" },
			directory: "/elsewhere",
		});
		expect(apply({}, event("session.renamed", { sessionID: "ses-9", title: "x" }))).toEqual({});
	});

	it("removes chats on session.deleted", () => {
		const chats = records({ "ses-1": { info: info("ses-1") }, "ses-2": {} });

		expect(Object.keys(apply(chats, event("session.deleted", { sessionID: "ses-1" })))).toEqual([
			"ses-2",
		]);
	});

	it("ignores unrelated and malformed events", () => {
		const chats = records({ "ses-1": {} });

		expect(apply(chats, event("session.text.delta", { sessionID: "ses-1", delta: "x" }))).toBe(
			chats,
		);
		expect(apply(chats, event("permission.asked", { id: "p" }))).toBe(chats);
		expect(apply(chats, event("session.created", { sessionID: 3 }))).toBe(chats);
		expect(apply(chats, execution("ses-1", "failed", { error: "weird" }))).toBe(chats);
	});
});

describe("hydrated status", () => {
	it("stamps workingSince for a chat first seen working", () => {
		expect(applyHydratedStatus(undefined, "busy", NOW)).toEqual({
			...IDLE,
			status: "busy",
			workingSince: NOW,
		});
		expect(
			applyHydratedStatus({ ...IDLE, status: "busy", workingSince: 5 }, "busy", NOW),
		).toBeNull();
	});

	it("skips busy only when a live completion raced hydration", () => {
		const done = { ...IDLE, completedAt: NOW - 10 };

		expect(applyHydratedStatus(done, "busy", NOW, { skipBusyIfCompleted: true })).toBeNull();
		expect(applyHydratedStatus(done, "busy", NOW)).toEqual({
			...IDLE,
			status: "busy",
			workingSince: NOW,
			completedAt: undefined,
		});
	});

	it("settles a stale working chat as idle without inventing a completion", () => {
		expect(applyHydratedStatus({ ...IDLE, status: "busy", workingSince: 5 }, "idle", NOW)).toEqual({
			...IDLE,
			workingSince: undefined,
		});
		expect(applyHydratedStatus(IDLE, "idle", NOW)).toBeNull();
		expect(applyHydratedStatus(IDLE, "unknown", NOW)).toBeNull();
	});
});

describe("when the server goes away", () => {
	it("settles every turn and drops pending prompts, keeping chat info", () => {
		const chats = records({
			"ses-1": {
				info: info("ses-1"),
				activity: { status: "busy", workingSince: 5, pendingPermissionIds: ["p"] },
			},
			"ses-2": { activity: { completedAt: 3 } },
		});

		const reset = resetActivity(chats);

		expect(reset["ses-1"]).toEqual({ info: info("ses-1"), activity: IDLE });
		expect(reset["ses-2"]).toBe(chats["ses-2"]);
		expect(resetActivity(reset)).toBe(reset);
	});
});

describe("chat lineage", () => {
	const chats = records({
		root: { info: info("root") },
		child: { info: info("child", { parentId: "root", metadata: {} }) },
		grandchild: { info: info("grandchild", { parentId: "child", metadata: {} }) },
		loopA: { info: info("loopA", { parentId: "loopB" }) },
		loopB: { info: info("loopB", { parentId: "loopA" }) },
	});

	it("walks from a chat up to its root", () => {
		expect(lineageOf(chats, "grandchild")).toEqual(["grandchild", "child", "root"]);
		expect(lineageOf(chats, "unknown")).toEqual(["unknown"]);
		expect(lineageOf(chats, "loopA")).toEqual(["loopA", "loopB"]);
	});

	it("names the unknown ancestors of chats that are working or waiting on the user", () => {
		const waiting = records({
			...chats,
			orphan: { activity: { pendingPermissionIds: ["p"] } },
			nested: { info: info("nested", { parentId: "missing" }), activity: { status: "busy" } },
			linked: { info: info("linked", { parentId: "root" }), activity: { status: "busy" } },
			quiet: { info: info("quiet", { parentId: "gone" }) },
		});

		expect(chatsAwaitingLineage(waiting).sort()).toEqual(["missing", "orphan"]);
	});
});

describe("publishing chats", () => {
	it("lists this app's chats and their subagents, inheriting the root's stamp", () => {
		const chats = records({
			root: {
				info: info("root", {
					metadata: desktop({
						workspaceId: "w1",
						worktree: { branch: "kilo/fix" },
						workspaceFolders: [{ path: "/repo", isPrimary: true }],
						workSessionId: "wses_1",
					}),
				}),
				activity: { status: "busy", workingSince: 7 },
			},
			child: { info: info("child", { parentId: "root", metadata: {}, archivedAt: 30 }) },
			cli: { info: info("cli", { metadata: {} }) },
			cliChild: { info: info("cliChild", { parentId: "cli", metadata: {} }) },
			orphan: { info: info("orphan", { parentId: "unknown", metadata: {} }) },
			bare: { activity: { status: "busy" } },
		});

		const published = publishChats(chats);

		expect(Object.keys(published).sort()).toEqual(["child", "root"]);
		expect(published.root).toEqual({
			id: "root",
			title: "Chat root",
			directory: "/repo",
			parentId: null,
			workspaceId: "w1",
			worktreeBranch: "kilo/fix",
			workspaceFolders: [{ path: "/repo", isPrimary: true }],
			workSessionId: "wses_1",
			createdAt: 10,
			updatedAt: 20,
			activity: { ...IDLE, status: "busy", workingSince: 7 },
		} satisfies ChatSummary);
		expect(published.child).toMatchObject({
			parentId: "root",
			workspaceId: "w1",
			worktreeBranch: "kilo/fix",
			workSessionId: "wses_1",
			archivedAt: 30,
		});
		expect(publishChats(chats).root).toBe(published.root);
	});
});

describe("diffing published chats", () => {
	const summary = (id: string, activity: Partial<ChatActivityState> = {}, title = `Chat ${id}`) =>
		publishChats(records({ [id]: { info: info(id, { title }), activity } }))[id]!;

	it("announces new and changed chats", () => {
		const a = summary("a");
		const renamed = summary("a", {}, "Renamed");
		const b = summary("b");

		expect(diffChats({ a }, { a: renamed, b }, { activity: false })).toEqual([
			{ name: "updated", payload: { before: a, after: renamed } },
			{ name: "created", payload: { chat: b } },
		]);
		expect(diffChats({ a }, { a: summary("a") }, { activity: true })).toEqual([]);
	});

	it("announces turns and prompts only when asked to", () => {
		const idle = summary("a");
		const busy = summary("a", { status: "busy", workingSince: 1, pendingPermissionIds: ["p"] });
		const done = summary("a", {
			completedAt: 2,
			lastError: { name: "APIError", message: "x" },
			pendingQuestionIds: ["q"],
		});

		expect(diffChats({ a: idle }, { a: busy }, { activity: true }).slice(1)).toEqual([
			{ name: "turn-started", payload: { chatId: "a" } },
			{ name: "permission-requested", payload: { chatId: "a", permissionId: "p" } },
		]);
		expect(diffChats({ a: busy }, { a: done }, { activity: true }).slice(1)).toEqual([
			{ name: "turn-ended", payload: { chatId: "a", error: { name: "APIError", message: "x" } } },
			{ name: "permission-resolved", payload: { chatId: "a", permissionId: "p" } },
			{ name: "question-requested", payload: { chatId: "a", questionId: "q" } },
		]);
		expect(diffChats({ a: done }, { a: idle }, { activity: true }).slice(1)).toEqual([
			{ name: "question-resolved", payload: { chatId: "a", questionId: "q" } },
		]);
		expect(diffChats({ a: idle }, { a: busy }, { activity: false })).toHaveLength(1);
	});
});
