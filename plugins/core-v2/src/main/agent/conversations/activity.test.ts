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
const status = (sessionID: string, type: string): KiloEvent => ({
	type: "session.status",
	properties: { sessionID, status: { type } },
});

describe("applying Kilo events", () => {
	it("tracks pending permissions by id and ignores duplicates", () => {
		const asked = { type: "permission.asked", properties: { id: "perm-1", sessionID: "ses-1" } };
		const first = apply({}, asked);
		expect(first["ses-1"]?.activity.pendingPermissionIds).toEqual(["perm-1"]);
		expect(apply(first, asked)).toBe(first);

		const replied = apply(first, {
			type: "permission.replied",
			properties: { sessionID: "ses-1", requestID: "perm-1" },
		});
		expect(replied["ses-1"]?.activity.pendingPermissionIds).toEqual([]);
	});

	it("tracks v2 permission events", () => {
		const asked = apply(
			{},
			{
				type: "permission.v2.asked",
				properties: { id: "perm-9", sessionID: "ses-1" },
			},
		);
		const replied = apply(asked, {
			type: "permission.v2.replied",
			properties: { sessionID: "ses-1", requestID: "perm-9" },
		});

		expect(asked["ses-1"]?.activity.pendingPermissionIds).toEqual(["perm-9"]);
		expect(replied["ses-1"]?.activity.pendingPermissionIds).toEqual([]);
	});

	it("tracks questions across asked, replied and rejected", () => {
		let chats = apply(
			{},
			{ type: "question.asked", properties: { id: "q-1", sessionID: "ses-1" } },
		);
		chats = apply(chats, {
			type: "question.v2.asked",
			properties: { id: "q-2", sessionID: "ses-1" },
		});
		expect(chats["ses-1"]?.activity.pendingQuestionIds).toEqual(["q-1", "q-2"]);

		chats = apply(chats, {
			type: "question.replied",
			properties: { sessionID: "ses-1", requestID: "q-1" },
		});
		chats = apply(chats, {
			type: "question.v2.rejected",
			properties: { sessionID: "ses-1", requestID: "q-2" },
		});
		expect(chats["ses-1"]?.activity.pendingQuestionIds).toEqual([]);
	});

	it("stamps workingSince on the idle-to-busy edge only", () => {
		const busy = apply({}, status("ses-1", "busy"));
		const retry = apply(busy, status("ses-1", "retry"), NOW + 5000);

		expect(busy["ses-1"]?.activity).toMatchObject({ status: "busy", workingSince: NOW });
		expect(retry["ses-1"]?.activity).toMatchObject({ status: "retry", workingSince: NOW });
	});

	it("stamps completedAt on the busy-to-idle edge and clears workingSince", () => {
		const busy = records({ "ses-1": { activity: { status: "busy", workingSince: NOW - 3000 } } });

		expect(apply(busy, status("ses-1", "idle"))["ses-1"]?.activity).toEqual({
			...IDLE,
			completedAt: NOW,
		});
		expect(
			apply(busy, { type: "session.idle", properties: { sessionID: "ses-1" } })["ses-1"]?.activity
				.completedAt,
		).toBe(NOW);
	});

	it("ignores idle for unknown or already idle chats", () => {
		const idle = records({ "ses-1": {} });

		expect(apply({}, status("ses-1", "idle"))).toEqual({});
		expect(apply(idle, { type: "session.idle", properties: { sessionID: "ses-1" } })).toBe(idle);
	});

	it("keeps a turn's error until the next turn starts, but not an abort", () => {
		let chats = apply({}, status("ses-1", "busy"));
		chats = apply(chats, {
			type: "session.error",
			properties: {
				sessionID: "ses-1",
				error: { name: "APIError", data: { message: "Rate limited" } },
			},
		});
		chats = apply(chats, status("ses-1", "idle"));
		expect(chats["ses-1"]?.activity.lastError).toEqual({
			name: "APIError",
			message: "Rate limited",
		});

		const aborted = apply(chats, {
			type: "session.error",
			properties: { sessionID: "ses-1", error: { name: "MessageAbortedError", data: {} } },
		});
		expect(aborted).toBe(chats);
		expect(apply(chats, status("ses-1", "busy"))["ses-1"]?.activity.lastError).toBeUndefined();
	});

	it("records chat info from created and updated events, and where events came from", () => {
		const raw = {
			id: "ses-1",
			title: "Fix login",
			directory: "/repo/project",
			parentID: "ses-0",
			metadata: desktop({ workspaceId: "ws-1" }),
			time: { created: NOW - 100, updated: NOW, archived: NOW },
		};
		const created = apply(
			{},
			{
				type: "session.created",
				properties: { info: raw },
				directory: "/repo/project",
			},
		);

		expect(created["ses-1"]).toEqual({
			info: {
				id: "ses-1",
				title: "Fix login",
				parentId: "ses-0",
				directory: "/repo/project",
				metadata: desktop({ workspaceId: "ws-1" }),
				createdAt: NOW - 100,
				updatedAt: NOW,
				archivedAt: NOW,
			},
			activity: IDLE,
			directory: "/repo/project",
		});
		expect(
			apply(created, {
				type: "session.updated",
				properties: { info: raw },
				directory: "/repo/project",
			}),
		).toBe(created);
		expect(
			apply(created, {
				type: "session.updated",
				properties: { info: { ...raw, title: "Fix sign-in" } },
			})["ses-1"]?.info?.title,
		).toBe("Fix sign-in");
	});

	it("removes chats on session.deleted", () => {
		const chats = records({ "ses-1": { info: info("ses-1") }, "ses-2": {} });

		expect(
			Object.keys(apply(chats, { type: "session.deleted", properties: { info: { id: "ses-1" } } })),
		).toEqual(["ses-2"]);
	});

	it("ignores unrelated and malformed events", () => {
		const chats = records({ "ses-1": {} });

		expect(
			apply(chats, { type: "message.part.updated", properties: { part: { sessionID: "ses-1" } } }),
		).toBe(chats);
		expect(apply(chats, { type: "permission.asked", properties: { id: "p" } })).toBe(chats);
		expect(apply(chats, { type: "session.updated", properties: { info: { id: 3 } } })).toBe(chats);
		expect(apply(chats, status("ses-1", "weird"))).toBe(chats);
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
