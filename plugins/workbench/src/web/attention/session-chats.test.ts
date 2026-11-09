import { describe, expect, it } from "vitest";

import type { ChatActivity, ChatSummary } from "@kilo-desktop/plugin-agent/contracts";
import type { WorkSession } from "@kilo-desktop/plugin-sessions/contracts";

import {
	chatsOfSessions,
	rootChatOf,
	sessionActivities,
	sessionOfChat,
	type Chats,
} from "./session-chats";

function session(id: string, patch: Partial<WorkSession> = {}): WorkSession {
	return {
		id,
		title: id,
		titleSource: "user",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: "w1",
		worktreeBranch: null,
		directory: "/projects/app",
		chatIds: [],
		createdAt: 1,
		updatedAt: 2,
		...patch,
	};
}

function chat(
	id: string,
	activity: Partial<ChatActivity> = {},
	patch: Partial<ChatSummary> = {},
): ChatSummary {
	return {
		id,
		title: id,
		directory: "/projects/app",
		parentId: null,
		workspaceId: "w1",
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: 1,
		updatedAt: 2,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [], ...activity },
		...patch,
	};
}

const byId = (...chats: ChatSummary[]): Chats =>
	Object.fromEntries(chats.map((summary) => [summary.id, summary]));

describe("rootChatOf", () => {
	it("walks up parents to the root, stopping at unknown ancestors and cycles", () => {
		const chats = byId(
			chat("root"),
			chat("child", {}, { parentId: "root" }),
			chat("grandchild", {}, { parentId: "child" }),
			chat("orphan", {}, { parentId: "missing" }),
			chat("a", {}, { parentId: "b" }),
			chat("b", {}, { parentId: "a" }),
		);

		expect(rootChatOf(chats, "grandchild")).toBe("root");
		expect(rootChatOf(chats, "root")).toBe("root");
		expect(rootChatOf(chats, "orphan")).toBe("missing");
		expect(["a", "b"]).toContain(rootChatOf(chats, "a"));
	});
});

describe("chatsOfSessions", () => {
	it("gives each session its chats and their subagents, including chats created for it", () => {
		const chats = byId(
			chat("c1"),
			chat("c1-sub", {}, { parentId: "c1" }),
			chat("c1-sub-sub", {}, { parentId: "c1-sub" }),
			chat("c2", {}, { workSessionId: "s2" }),
			chat("loose"),
		);
		const result = chatsOfSessions(
			[session("s1", { chatIds: ["c1", "gone"] }), session("s2")],
			chats,
		);

		expect(result.get("s1")?.map((summary) => summary.id)).toEqual(["c1", "c1-sub", "c1-sub-sub"]);
		expect(result.get("s2")?.map((summary) => summary.id)).toEqual(["c2"]);
	});
});

describe("sessionOfChat", () => {
	it("finds the session holding a chat's root", () => {
		const chats = byId(
			chat("c1"),
			chat("sub", {}, { parentId: "c1" }),
			chat("c2", {}, { workSessionId: "s2" }),
		);
		const sessions = [session("s1", { chatIds: ["c1"] }), session("s2")];

		expect(sessionOfChat(sessions, chats, "sub")).toBe("s1");
		expect(sessionOfChat(sessions, chats, "c2")).toBe("s2");
		expect(sessionOfChat(sessions, chats, "unknown")).toBeNull();
	});
});

describe("sessionActivities", () => {
	it("keeps what the session knows when it has no chats", () => {
		const activity = sessionActivities([session("s1", { worktreeBranch: "kilo/x" })], {})["s1"];

		expect(activity).toMatchObject({
			workspaceId: "w1",
			worktreeBranch: "kilo/x",
			directory: "/projects/app",
			pendingPermissionIds: [],
			pendingQuestionIds: [],
		});
		expect(activity?.status).toBeUndefined();
	});

	it("bubbles subagents' prompts up and works while any chat works, from the earliest start", () => {
		const chats = byId(
			chat("c1", { status: "busy", workingSince: 300 }),
			chat(
				"sub",
				{ status: "retry", workingSince: 200, pendingPermissionIds: ["p1"] },
				{ parentId: "c1" },
			),
			chat("c2", { pendingQuestionIds: ["q1"], completedAt: 50 }),
		);
		const activity = sessionActivities([session("s1", { chatIds: ["c1", "c2"] })], chats)["s1"];

		expect(activity).toMatchObject({
			status: "busy",
			workingSince: 200,
			completedAt: 50,
			pendingPermissionIds: ["p1"],
			pendingQuestionIds: ["q1"],
		});
	});

	it("is idle when every chat is idle, finished at the latest completion, with a root's failure", () => {
		const chats = byId(
			chat("c1", { completedAt: 100, lastError: { name: "ApiError", message: "Rate limited" } }),
			chat(
				"sub",
				{ completedAt: 400, lastError: { name: "ToolError", message: "x" } },
				{ parentId: "c1" },
			),
			chat("c2", { completedAt: 250 }),
		);
		const activity = sessionActivities([session("s1", { chatIds: ["c1", "c2"] })], chats)["s1"];

		expect(activity).toMatchObject({
			status: "idle",
			completedAt: 400,
			lastError: { name: "ApiError", message: "Rate limited" },
		});
		expect(activity?.workingSince).toBeUndefined();
	});

	it("reports retry while retrying and nothing busier", () => {
		const chats = byId(chat("c1", { status: "retry", workingSince: 10 }));

		expect(sessionActivities([session("s1", { chatIds: ["c1"] })], chats)["s1"]?.status).toBe(
			"retry",
		);
	});
});
