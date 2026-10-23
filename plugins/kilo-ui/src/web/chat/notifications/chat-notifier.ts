import type { OpenCodeServerEvent } from "@assistant-ui/react-opencode";

import {
	hasKiloDesktopSessionMetadata,
	type SessionActivity,
} from "../../session/activity/session-activity-logic.js";
import type { NotificationMode } from "./notification-preferences.js";

export type ChatCue = "done" | "needsYou";

export type AlertReason = "done" | "permission" | "question" | "error";

/** Same bound as prompt-ancestry hydration; also stops a parent cycle. */
const MAX_PARENT_HOPS = 8;

export interface ChatNotifierDeps {
	/** Known sessions: root chats have `createdAt`, subagents have `parentId`. */
	sessions: () => Readonly<Record<string, SessionActivity>>;
	getMode: (cue: ChatCue) => NotificationMode;
	isAppFocused: () => boolean;
	/** True when you're looking at this chat right now. */
	isViewingChat: (sessionId: string) => boolean;
	playSound: (cue: ChatCue) => void;
	showNotification: (reason: AlertReason) => void;
}

/**
 * Returns a handler for live server events. Only the live stream feeds it, so
 * startup state and the UI's synthetic status updates never notify.
 *
 * - done: a known root chat goes idle after working, unless that turn failed.
 * - needs you: an approval or question (a subagent's, at any depth, counts as
 *   its chat), or a root chat's turn failing. Pressing stop is not a failure.
 *
 * Root sessions created without Kilo Desktop metadata (the hidden throwaway
 * sessions behind commit/PR text generation) are not chats and never notify.
 */
export function createChatNotifier(deps: ChatNotifierDeps): (event: OpenCodeServerEvent) => void {
	const working = new Set<string>();
	const failed = new Set<string>();
	const hidden = new Set<string>();

	const isRootChat = (id: string) => {
		if (hidden.has(id)) return false;
		const session = deps.sessions()[id];
		return session?.createdAt !== undefined && session.parentId === undefined;
	};

	const chatOf = (id: string) => {
		let chatId = id;
		for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
			const parentId = deps.sessions()[chatId]?.parentId;
			if (!parentId) break;
			chatId = parentId;
		}
		return chatId;
	};

	const notify = (cue: ChatCue, reason: AlertReason, chatId: string) => {
		const mode = deps.getMode(cue);
		if (mode === "off") return;
		if (mode === "always" || !deps.isViewingChat(chatId)) deps.playSound(cue);
		if (!deps.isAppFocused()) deps.showNotification(reason);
	};

	const finished = (id: string) => {
		if (!working.delete(id) || !isRootChat(id)) return;
		if (failed.delete(id)) return;
		notify("done", "done", id);
	};

	return (event) => {
		const info = event.properties["info"] as
			| { id?: string; parentID?: string; metadata?: unknown }
			| undefined;
		const id = event.sessionId ?? info?.id;
		if (!id) return;
		switch (event.type) {
			case "session.created":
				if (info && !info.parentID && !hasKiloDesktopSessionMetadata(info.metadata)) {
					hidden.add(id);
				}
				return;
			case "session.status": {
				const status = event.properties["status"] as { type?: string } | undefined;
				if (status?.type === "idle") return finished(id);
				if (!working.has(id)) failed.delete(id);
				working.add(id);
				return;
			}
			case "session.idle":
				return finished(id);
			case "permission.asked":
			case "permission.v2.asked":
				return notify("needsYou", "permission", chatOf(id));
			case "question.asked":
			case "question.v2.asked":
				return notify("needsYou", "question", chatOf(id));
			case "session.deleted":
				working.delete(id);
				failed.delete(id);
				hidden.delete(id);
				return;
			case "session.error": {
				const error = event.properties["error"] as { name?: string } | undefined;
				if (error?.name === "MessageAbortedError" || !isRootChat(id)) return;
				failed.add(id);
				return notify("needsYou", "error", id);
			}
		}
	};
}
