import { describe, expect, it } from "vitest";

import type { ChatActivity, ChatSummary } from "@kilo-desktop/plugin-core/contracts";

import {
	createChatNotifier,
	type AlertReason,
	type ChatCue,
	type NotificationMode,
} from "./chat-notifier";

function chat(id: string, patch: Partial<ChatSummary> = {}): ChatSummary {
	return {
		id,
		title: id,
		directory: "/projects/app",
		parentId: null,
		workspaceId: null,
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: 1,
		updatedAt: 1,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [] },
		...patch,
	};
}

function setup() {
	const chats: Record<string, ChatSummary> = {
		"ses-1": chat("ses-1"),
		"ses-2": chat("ses-2"),
		"child-1": chat("child-1", { parentId: "ses-1" }),
		"grandchild-1": chat("grandchild-1", { parentId: "child-1" }),
	};
	const sounds: ChatCue[] = [];
	const banners: { reason: AlertReason; chatId: string }[] = [];
	const modes: Record<ChatCue, NotificationMode> = { done: "smart", needsYou: "smart" };
	let focused = false;
	let viewing: string | null = null;
	const onEvent = createChatNotifier({
		chats: () => chats,
		getMode: (cue) => modes[cue],
		isAppFocused: () => focused,
		isViewingChat: (chatId) => focused && viewing === chatId,
		playSound: (cue) => sounds.push(cue),
		showNotification: (reason, chatId) => banners.push({ reason, chatId }),
	});
	const updated = (id: string, before: Partial<ChatActivity>, after: Partial<ChatActivity>) => {
		const base = chats[id]!;
		onEvent({
			name: "updated",
			payload: {
				before: { ...base, activity: { ...base.activity, ...before } },
				after: { ...base, activity: { ...base.activity, ...after } },
			},
		});
	};
	return {
		sounds,
		reasons: () => banners.map((banner) => banner.reason),
		banners,
		finishTurn: (chatId: string, error?: { name: string; message: string }) =>
			onEvent({ name: "turn-ended", payload: { chatId, ...(error ? { error } : {}) } }),
		completeWork: (chatId: string) => onEvent({ name: "work-completed", payload: { chatId } }),
		askPermission: (chatId: string) =>
			onEvent({ name: "permission-requested", payload: { chatId, permissionId: "p" } }),
		askQuestion: (chatId: string) =>
			onEvent({ name: "question-requested", payload: { chatId, questionId: "q" } }),
		updated,
		other: () => onEvent({ name: "turn-started", payload: { chatId: "ses-1" } }),
		setMode: (cue: ChatCue, mode: NotificationMode) => {
			modes[cue] = mode;
		},
		look: (chatId: string | null) => {
			focused = chatId !== null;
			viewing = chatId;
		},
		focus: (value: boolean) => {
			focused = value;
		},
	};
}

const failure = { name: "ApiError", message: "Rate limited" };

describe("createChatNotifier", () => {
	it("plays done when a chat's work is complete, not when an individual turn ends", () => {
		const { sounds, finishTurn, completeWork, other } = setup();

		other();
		finishTurn("ses-1");
		expect(sounds).toEqual([]);

		completeWork("ses-1");
		expect(sounds).toEqual(["done"]);
	});

	it("ignores subagents and chats it doesn't know as chats finishing", () => {
		const { sounds, finishTurn, completeWork } = setup();

		finishTurn("child-1");
		finishTurn("unlisted");
		completeWork("child-1");
		completeWork("unlisted");

		expect(sounds).toEqual([]);
	});

	it("plays needs-you for approvals, questions, and failed turns instead of done", () => {
		const { sounds, askPermission, askQuestion, finishTurn } = setup();

		askPermission("ses-1");
		askQuestion("ses-2");
		finishTurn("ses-1", failure);

		expect(sounds).toEqual(["needsYou", "needsYou", "needsYou"]);
	});

	it("ignores a subagent's failure", () => {
		const { sounds, finishTurn } = setup();

		finishTurn("child-1", failure);

		expect(sounds).toEqual([]);
	});

	it("plays needs-you for a failure that arrives after the turn ended, once", () => {
		const { sounds, completeWork, updated } = setup();

		completeWork("ses-1");
		updated("ses-1", {}, { lastError: failure });
		updated("ses-1", { lastError: failure }, { lastError: failure, completedAt: 5 });
		updated("ses-1", { status: "busy" }, { lastError: failure });
		updated("child-1", {}, { lastError: failure });
		completeWork("ses-1");

		expect(sounds).toEqual(["done", "needsYou", "done"]);
	});

	it("treats a subagent's request as its chat when deciding whether you're looking", () => {
		const { sounds, banners, askPermission, askQuestion, look } = setup();

		look("ses-1");
		askPermission("child-1");
		expect(sounds).toEqual([]);

		askQuestion("grandchild-1");
		expect(sounds).toEqual([]);

		look("ses-2");
		askPermission("child-1");
		expect(sounds).toEqual(["needsYou"]);

		look(null);
		askQuestion("grandchild-1");
		expect(banners.at(-1)).toEqual({ reason: "question", chatId: "ses-1" });
	});

	it("applies each cue's mode on its own", () => {
		const { sounds, askQuestion, completeWork, look, setMode } = setup();
		look("ses-1");

		setMode("needsYou", "always");
		askQuestion("ses-1");
		expect(sounds).toEqual(["needsYou"]);

		look(null);
		setMode("done", "off");
		completeWork("ses-1");
		expect(sounds).toEqual(["needsYou"]);
	});

	it("shows a system notification only while Kilo is in the background", () => {
		const { reasons, askQuestion, askPermission, finishTurn, completeWork, look, focus, setMode } =
			setup();

		look("ses-2");
		askQuestion("ses-1");
		expect(reasons()).toEqual([]);

		focus(false);
		completeWork("ses-1");
		finishTurn("ses-2", failure);
		setMode("needsYou", "off");
		askPermission("ses-1");
		expect(reasons()).toEqual(["done", "error"]);
	});
});
