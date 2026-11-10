import type { DomainObjectEventName, DomainObjectEventPayload } from "@kilo-desktop/kernel";
import type { ChatError, Chats } from "@kilo-desktop/plugin-core/contracts";

import { rootChatOf, type ChatsById } from "../attention/session-chats";

export type ChatCue = "done" | "needsYou";

export type AlertReason = "done" | "permission" | "question" | "error";

/**
 * When a cue notifies: its sound, plus a system notification while Kilo is in
 * the background. `smart` skips the chat you're already looking at.
 */
export type NotificationMode = "off" | "smart" | "always";

export type ChatEvent = {
	[TName in DomainObjectEventName<typeof Chats>]: {
		readonly name: TName;
		readonly payload: DomainObjectEventPayload<typeof Chats, TName>;
	};
}[DomainObjectEventName<typeof Chats>];

export interface ChatNotifierDeps {
	/** kilo.core's chats: root chats have no `parentId`. */
	chats: () => ChatsById;
	getMode: (cue: ChatCue) => NotificationMode;
	isAppFocused: () => boolean;
	/** True when you're looking at this (root) chat's session right now. */
	isViewingChat: (chatId: string) => boolean;
	playSound: (cue: ChatCue) => void;
	showNotification: (reason: AlertReason, chatId: string) => void;
}

const isWorking = (status: string) => status === "busy" || status === "retry";

const sameError = (a: ChatError | undefined, b: ChatError | undefined) =>
	a?.name === b?.name && a?.message === b?.message;

/**
 * Returns a handler for kilo.core's chat events, which fire only for
 * live changes, so startup state never notifies. kilo.core publishes only
 * this app's chats, so origin's hidden throwaway sessions never reach it.
 *
 * - done: the server confirms a root chat's work, including subagents and
 *   queued background reports, is complete (stopping is not failing).
 * - needs you: an approval or question (a subagent's, at any depth, counts as
 *   its chat), or a root chat's turn failing — also when the failure arrives
 *   after the turn ended.
 */
export function createChatNotifier(deps: ChatNotifierDeps): (event: ChatEvent) => void {
	const isRootChat = (id: string) => deps.chats()[id]?.parentId === null;

	const notify = (cue: ChatCue, reason: AlertReason, chatId: string) => {
		const mode = deps.getMode(cue);
		if (mode === "off") return;
		if (mode === "always" || !deps.isViewingChat(chatId)) deps.playSound(cue);
		if (!deps.isAppFocused()) deps.showNotification(reason, chatId);
	};

	return (event) => {
		switch (event.name) {
			case "work-completed": {
				const { chatId } = event.payload;
				if (isRootChat(chatId)) notify("done", "done", chatId);
				return;
			}
			case "turn-ended": {
				const { chatId, error } = event.payload;
				if (isRootChat(chatId) && error) notify("needsYou", "error", chatId);
				return;
			}
			case "permission-requested":
				return notify("needsYou", "permission", rootChatOf(deps.chats(), event.payload.chatId));
			case "question-requested":
				return notify("needsYou", "question", rootChatOf(deps.chats(), event.payload.chatId));
			case "updated": {
				const { before, after } = event.payload;
				if (after.parentId !== null || !after.activity.lastError) return;
				if (isWorking(before.activity.status) || isWorking(after.activity.status)) return;
				if (sameError(before.activity.lastError, after.activity.lastError)) return;
				return notify("needsYou", "error", after.id);
			}
		}
	};
}
