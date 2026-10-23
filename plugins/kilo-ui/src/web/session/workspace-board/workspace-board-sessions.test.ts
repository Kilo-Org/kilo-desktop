import { describe, expect, it } from "vitest";

import type { WorkspaceBoardState } from "../../../contracts/workspace-board/board-model.js";
import { createEmptySessionActivity } from "../activity/session-activity-logic.js";
import { UNSCOPED_WORKSPACE_FOCUS } from "../list/session-list-view.js";
import {
	boardCardStatus,
	buildBoardSessions,
	resolveBoardColumns,
} from "./workspace-board-sessions.js";

const activity = (patch: Partial<ReturnType<typeof createEmptySessionActivity>>) => ({
	...createEmptySessionActivity(),
	...patch,
});

describe("buildBoardSessions", () => {
	it("indexes a session by its work session id and skips chats no session owns", () => {
		const sessions = buildBoardSessions({
			threadItems: [
				{ id: "ses_1", remoteId: "ses_1", title: "Fix login", status: "regular" },
				{ id: "ses_2", remoteId: "ses_2", title: "Unowned", status: "regular" },
			],
			sessionIdByChat: { ses_1: "wses_a" },
			activityBySessionId: {},
			lastVisitedAtBySessionId: {},
		});

		expect([...sessions.keys()]).toEqual(["wses_a"]);
		expect(sessions.get("wses_a")).toMatchObject({ sessionId: "wses_a", kiloSessionId: "ses_1" });
	});

	it("indexes created chats by their session with their live state", () => {
		const sessions = buildBoardSessions({
			threadItems: [
				{ id: "t1", remoteId: "ses_1", title: "Fix login", status: "regular" },
				{ id: "t2", remoteId: "ses_2", title: undefined, status: "archived" },
				{ id: "draft", remoteId: undefined, title: "Unsent", status: "regular" },
			],
			sessionIdByChat: { ses_1: "ses_1", ses_2: "ses_2" },
			activityBySessionId: {
				ses_1: activity({ status: "busy", workspaceId: "w1" }),
				ses_2: activity({ pendingPermissionIds: ["p1"] }),
			},
			lastVisitedAtBySessionId: {},
		});

		expect([...sessions.keys()]).toEqual(["ses_1", "ses_2"]);
		expect(sessions.get("ses_1")).toMatchObject({
			sessionId: "ses_1",
			threadId: "t1",
			title: "Fix login",
			archived: false,
			rowState: "working",
		});
		expect(sessions.get("ses_2")).toMatchObject({
			title: "New session",
			archived: true,
			rowState: "approval",
		});
	});
});

describe("resolveBoardColumns", () => {
	const board: WorkspaceBoardState = {
		columns: [
			{ id: "backlog", label: "Backlog", sessionIds: ["ses_1", "gone", "ses_2"] },
			{ id: "done", label: "Done", sessionIds: ["ses_3", "ses_4"] },
		],
	};
	const sessions = buildBoardSessions({
		threadItems: [
			{ id: "t1", remoteId: "ses_1", title: "One", status: "regular" },
			{ id: "t2", remoteId: "ses_2", title: "Two", status: "regular" },
			{ id: "t3", remoteId: "ses_3", title: "Three", status: "regular" },
			{ id: "t4", remoteId: "ses_4", title: "Four", status: "regular" },
		],
		sessionIdByChat: { ses_1: "ses_1", ses_2: "ses_2", ses_3: "ses_3", ses_4: "ses_4" },
		activityBySessionId: {
			ses_1: activity({ workspaceId: "w1" }),
			ses_2: activity({ workspaceId: "w2" }),
			ses_3: activity({ workspaceId: "w1" }),
			ses_4: activity({}),
		},
		lastVisitedAtBySessionId: {},
	});

	it("keeps board order and hides cards whose chat is not loaded", () => {
		const columns = resolveBoardColumns(board, sessions, null);
		expect(columns.map((column) => [column.id, column.cards.map((card) => card.title)])).toEqual([
			["backlog", ["One", "Two"]],
			["done", ["Three", "Four"]],
		]);
	});

	it("reports each column's full card count and where its cards go if it is deleted", () => {
		const columns = resolveBoardColumns(board, sessions, "w1");
		expect(
			columns.map(({ cardCount, deleteDestination }) => [cardCount, deleteDestination]),
		).toEqual([
			[3, "Done"],
			[2, "Backlog"],
		]);
	});

	it("shows only cards from the focused workspace", () => {
		const columns = resolveBoardColumns(board, sessions, "w1");
		expect(columns.map((column) => column.cards.map((card) => card.sessionId))).toEqual([
			["ses_1"],
			["ses_3"],
		]);
	});

	it("shows only cards without a workspace while focused on no workspace", () => {
		const columns = resolveBoardColumns(board, sessions, UNSCOPED_WORKSPACE_FOCUS);
		expect(columns.map((column) => column.cards.map((card) => card.sessionId))).toEqual([
			[],
			["ses_4"],
		]);
	});
});

describe("boardCardStatus", () => {
	it("puts chats that need attention or are working ahead of being archived", () => {
		expect(boardCardStatus({ archived: true, rowState: "approval" })).toBe("approval");
		expect(boardCardStatus({ archived: true, rowState: "input" })).toBe("input");
		expect(boardCardStatus({ archived: true, rowState: "working" })).toBe("working");
	});

	it("shows archived ahead of an unread result, and idle when nothing applies", () => {
		expect(boardCardStatus({ archived: true, rowState: "done" })).toBe("archived");
		expect(boardCardStatus({ archived: false, rowState: "done" })).toBe("done");
		expect(boardCardStatus({ archived: false, rowState: null })).toBe("idle");
	});
});
