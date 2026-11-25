import { describe, expect, it } from "vitest";

import type { OpenCodeEvent } from "@kilocode/client";

import type { ChatSummary } from "../../../contracts";
import { kiloEvent, sessionInfo } from "../../../test/agent/kilo-events";
import {
	applyChatEvent,
	applyChatInfo,
	applyHydratedStatus,
	chatsAwaitingLineage,
	diffChats,
	IDLE,
	lineageOf,
	publishChats,
	readChatInfo,
	resetActivity,
	sessionChangedBy,
	type ChatActivityState,
	type ChatInfo,
	type ChatRecords,
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

const apply = (chats: ChatRecords, event: OpenCodeEvent, now = NOW) =>
	applyChatEvent(chats, event, now);
const execution = (sessionID: string, outcome: string, data: Record<string, unknown> = {}) =>
	kiloEvent(`session.execution.${outcome}`, { sessionID, ...data });

describe("applying Kilo events", () => {
	it("tracks pending permissions by id and ignores duplicates", () => {
		const asked = kiloEvent("permission.asked", {
			id: "per-1",
			sessionID: "ses-1",
			action: "shell",
			resources: ["ls"],
		});
		const first = apply({}, asked);
		expect(first["ses-1"]?.activity.pendingPermissionIds).toEqual(["per-1"]);
		expect(apply(first, asked)).toBe(first);

		const replied = apply(
			first,
			kiloEvent("permission.replied", { sessionID: "ses-1", requestID: "per-1", reply: "once" }),
		);
		expect(replied["ses-1"]?.activity.pendingPermissionIds).toEqual([]);
	});

	it("tracks forms as questions until replied or cancelled", () => {
		const form = (id: string) =>
			kiloEvent("form.created", { form: { id, sessionID: "ses-1", title: "Q", fields: [] } });
		let chats = apply(apply({}, form("frm-1")), form("frm-2"));
		expect(chats["ses-1"]?.activity.pendingQuestionIds).toEqual(["frm-1", "frm-2"]);

		chats = apply(
			chats,
			kiloEvent("form.replied", { id: "frm-1", sessionID: "ses-1", answer: {} }),
		);
		chats = apply(chats, kiloEvent("form.cancelled", { id: "frm-2", sessionID: "ses-1" }));
		expect(chats["ses-1"]?.activity.pendingQuestionIds).toEqual([]);
	});

	it("stamps workingSince when an execution starts, keeping it through retries", () => {
		const busy = apply({}, execution("ses-1", "started"));
		const retry = apply(
			busy,
			kiloEvent("session.retry.scheduled", { sessionID: "ses-1" }),
			NOW + 5,
		);

		expect(busy["ses-1"]?.activity).toMatchObject({ status: "busy", workingSince: NOW });
		expect(retry["ses-1"]?.activity).toMatchObject({ status: "retry", workingSince: NOW });
	});

	it("stamps completedAt when an execution succeeds or is interrupted", () => {
		const busy = records({ "ses-1": { activity: { status: "busy", workingSince: NOW - 3000 } } });

		expect(apply(busy, execution("ses-1", "succeeded"))["ses-1"]?.activity).toEqual({
			...IDLE,
			completedAt: NOW,
		});
		expect(
			apply(busy, execution("ses-1", "interrupted", { reason: "user" }))["ses-1"]?.activity
				.completedAt,
		).toBe(NOW);
	});

	it("ignores an execution ending for unknown or already idle chats", () => {
		const idle = records({ "ses-1": {} });

		expect(apply({}, execution("ses-1", "succeeded"))).toEqual({});
		expect(apply(idle, execution("ses-1", "succeeded"))).toBe(idle);
	});

	it("keeps a failed execution's error until the next execution starts", () => {
		let chats = apply({}, execution("ses-1", "started"));
		chats = apply(
			chats,
			execution("ses-1", "failed", { error: { type: "provider.no-route", message: "No route" } }),
		);
		expect(chats["ses-1"]?.activity).toMatchObject({
			status: "idle",
			completedAt: NOW,
			lastError: { name: "provider.no-route", message: "No route" },
		});
		expect(
			apply(chats, execution("ses-1", "started"))["ses-1"]?.activity.lastError,
		).toBeUndefined();
	});

	it("remembers the directory a chat's events came from", () => {
		const chats = apply({}, execution("ses-1", "started"), NOW);
		const located = apply(
			chats,
			kiloEvent("session.retry.scheduled", { sessionID: "ses-1" }, "/repo/project"),
		);

		expect(located["ses-1"]?.directory).toBe("/repo/project");
		expect(
			apply(located, kiloEvent("session.retry.scheduled", { sessionID: "ses-1" }, "/repo/project")),
		).toBe(located);
	});

	it("removes chats on session.deleted", () => {
		const chats = records({ "ses-1": { info: info("ses-1") }, "ses-2": {} });

		expect(Object.keys(apply(chats, kiloEvent("session.deleted", { sessionID: "ses-1" })))).toEqual(
			["ses-2"],
		);
	});

	it("ignores events about nothing it tracks", () => {
		const chats = records({ "ses-1": {} });

		expect(apply(chats, kiloEvent("session.text.delta", { sessionID: "ses-1", delta: "x" }))).toBe(
			chats,
		);
		expect(apply(chats, kiloEvent("server.connected"))).toBe(chats);
	});
});

describe("reading Kilo sessions", () => {
	it("reads a session as a chat in its location's directory", () => {
		expect(
			readChatInfo(
				sessionInfo("ses-1", {
					title: "Fix login",
					parentID: "ses-0",
					metadata: { "kilo-desktop": { workspaceId: "ws-1" } },
					location: { directory: "/repo/project" },
					time: { created: NOW - 100, updated: NOW, archived: NOW },
				}),
			),
		).toEqual({
			id: "ses-1",
			title: "Fix login",
			parentId: "ses-0",
			directory: "/repo/project",
			metadata: desktop({ workspaceId: "ws-1" }),
			createdAt: NOW - 100,
			updatedAt: NOW,
			archivedAt: NOW,
		});
		expect(readChatInfo(sessionInfo("ses-2"))).toMatchObject({
			title: "",
			parentId: null,
			metadata: null,
		});
	});

	it("names the session a created, forked or changed-session event is about", () => {
		for (const type of [
			"session.created",
			"session.forked",
			"session.renamed",
			"session.metadata.updated",
			"session.archived",
			"session.unarchived",
			"session.moved",
			"session.permissions",
		]) {
			expect(sessionChangedBy(kiloEvent(type, { sessionID: "ses-1" }))).toBe("ses-1");
		}
		expect(sessionChangedBy(execution("ses-1", "started"))).toBeUndefined();
	});

	it("records a chat's info read again, and where the event came from", () => {
		const created = applyChatInfo({}, info("ses-1"), "/repo/project");

		expect(created["ses-1"]).toEqual({
			info: info("ses-1"),
			activity: IDLE,
			directory: "/repo/project",
		});
		expect(applyChatInfo(created, info("ses-1"), "/repo/project")).toBe(created);
		expect(
			applyChatInfo(created, info("ses-1", { title: "Fix sign-in" }))["ses-1"]?.info?.title,
		).toBe("Fix sign-in");
	});
});

describe("hydrated activity", () => {
	it("stamps workingSince for a chat first seen working", () => {
		expect(applyHydratedStatus(undefined, true, NOW)).toEqual({
			...IDLE,
			status: "busy",
			workingSince: NOW,
		});
		expect(applyHydratedStatus({ ...IDLE, status: "busy", workingSince: 5 }, true, NOW)).toBeNull();
		expect(
			applyHydratedStatus({ ...IDLE, status: "retry", workingSince: 5 }, true, NOW),
		).toBeNull();
	});

	it("skips busy only when a live completion raced hydration", () => {
		const done = { ...IDLE, completedAt: NOW - 10 };

		expect(applyHydratedStatus(done, true, NOW, { skipBusyIfCompleted: true })).toBeNull();
		expect(applyHydratedStatus(done, true, NOW)).toEqual({
			...IDLE,
			status: "busy",
			workingSince: NOW,
			completedAt: undefined,
		});
	});

	it("settles a stale working chat as idle without inventing a completion", () => {
		expect(applyHydratedStatus({ ...IDLE, status: "busy", workingSince: 5 }, false, NOW)).toEqual({
			...IDLE,
			workingSince: undefined,
		});
		expect(applyHydratedStatus(IDLE, false, NOW)).toBeNull();
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
