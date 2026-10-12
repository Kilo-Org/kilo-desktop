import { describe, expect, it } from "vitest";

import {
	createEmptySessionActivity,
	type SessionActivity,
} from "../session-activity/session-activity-logic.js";
import { createChatNotifier, type AlertReason, type ChatCue } from "./chat-notifier.js";
import type { NotificationMode } from "./notification-preferences.js";

const chat = (patch: Partial<SessionActivity> = {}): SessionActivity => ({
	...createEmptySessionActivity(),
	createdAt: 1,
	...patch,
});

function setup() {
	const sessions: Record<string, SessionActivity> = {
		"ses-1": chat(),
		"ses-2": chat(),
		"child-1": chat({ parentId: "ses-1" }),
		"grandchild-1": chat({ parentId: "child-1" }),
		unlisted: createEmptySessionActivity(),
	};
	const sounds: ChatCue[] = [];
	const banners: AlertReason[] = [];
	const modes: Record<ChatCue, NotificationMode> = { done: "smart", needsYou: "smart" };
	let focused = false;
	let viewing: string | null = null;
	const onEvent = createChatNotifier({
		sessions: () => sessions,
		getMode: (cue) => modes[cue],
		isAppFocused: () => focused,
		isViewingChat: (sessionId) => focused && viewing === sessionId,
		playSound: (cue) => sounds.push(cue),
		showNotification: (reason) => banners.push(reason),
	});
	const emit = (type: string, sessionId: string, properties: Record<string, unknown> = {}) =>
		onEvent({ type, sessionId, properties: { sessionID: sessionId, ...properties }, raw: null });
	const status = (sessionId: string, type: "busy" | "idle") =>
		emit("session.status", sessionId, { status: { type } });
	return {
		sounds,
		banners,
		emit,
		status,
		finishTurn: (sessionId: string) => {
			status(sessionId, "busy");
			status(sessionId, "idle");
		},
		fail: (sessionId: string, name = "ApiError") =>
			emit("session.error", sessionId, { error: { name, data: {} } }),
		setMode: (cue: ChatCue, mode: NotificationMode) => {
			modes[cue] = mode;
		},
		look: (sessionId: string | null) => {
			focused = sessionId !== null;
			viewing = sessionId;
		},
	};
}

describe("createChatNotifier", () => {
	it("plays done once when a chat goes idle after working", () => {
		const { sounds, status, emit } = setup();

		status("ses-1", "idle");
		expect(sounds).toEqual([]);

		status("ses-1", "busy");
		status("ses-1", "idle");
		emit("session.idle", "ses-1");
		expect(sounds).toEqual(["done"]);
	});

	it("ignores subagents and sessions it doesn't know as chats finishing", () => {
		const { sounds, finishTurn } = setup();

		finishTurn("child-1");
		finishTurn("unlisted");

		expect(sounds).toEqual([]);
	});

	it("plays needs-you for approvals, questions, and failed turns", () => {
		const { sounds, emit, fail } = setup();

		emit("permission.asked", "ses-1", { id: "perm-1" });
		emit("question.asked", "ses-2", { id: "q-1" });
		fail("ses-1");

		expect(sounds).toEqual(["needsYou", "needsYou", "needsYou"]);
	});

	it("plays needs-you for v2 approval and question events", () => {
		const { sounds, emit } = setup();

		emit("permission.v2.asked", "ses-1", { id: "perm-1" });
		emit("question.v2.asked", "ses-2", { id: "q-1" });

		expect(sounds).toEqual(["needsYou", "needsYou"]);
	});

	it("does not also play done for a failed turn, but treats a stopped turn as done", () => {
		const { sounds, status, fail } = setup();

		status("ses-1", "busy");
		fail("ses-1");
		status("ses-1", "idle");
		expect(sounds).toEqual(["needsYou"]);

		status("ses-2", "busy");
		fail("ses-2", "MessageAbortedError");
		status("ses-2", "idle");
		expect(sounds).toEqual(["needsYou", "done"]);
	});

	it("does not let a late failure silence the next turn", () => {
		const { sounds, finishTurn, fail } = setup();

		finishTurn("ses-1");
		fail("ses-1");
		finishTurn("ses-1");

		expect(sounds).toEqual(["done", "needsYou", "done"]);
	});

	it("treats a subagent's request as its chat when deciding whether you're looking", () => {
		const { sounds, emit, look } = setup();

		look("ses-1");
		emit("permission.asked", "child-1", { id: "perm-1" });
		expect(sounds).toEqual([]);

		emit("question.asked", "grandchild-1", { id: "q-1" });
		expect(sounds).toEqual([]);

		look("ses-2");
		emit("permission.asked", "child-1", { id: "perm-2" });
		expect(sounds).toEqual(["needsYou"]);
	});

	it("forgets a chat deleted mid-turn", () => {
		const { sounds, status, emit } = setup();

		status("ses-1", "busy");
		emit("session.deleted", "ses-1");
		status("ses-1", "idle");

		expect(sounds).toEqual([]);
	});

	it("applies each cue's mode on its own", () => {
		const { sounds, emit, finishTurn, look, setMode } = setup();
		look("ses-1");

		setMode("needsYou", "always");
		emit("question.asked", "ses-1", { id: "q-1" });
		expect(sounds).toEqual(["needsYou"]);

		look(null);
		setMode("done", "off");
		finishTurn("ses-1");
		expect(sounds).toEqual(["needsYou"]);
	});

	it("shows a system notification only while Kilo is in the background", () => {
		const { banners, emit, finishTurn, fail, look, setMode } = setup();

		look("ses-2");
		emit("question.asked", "ses-1", { id: "q-1" });
		expect(banners).toEqual([]);

		look(null);
		finishTurn("ses-1");
		fail("ses-2");
		setMode("needsYou", "off");
		emit("permission.asked", "ses-1", { id: "perm-1" });
		expect(banners).toEqual(["done", "error"]);
	});
});
