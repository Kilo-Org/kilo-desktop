import { KernelNotifications, KernelWindows, type PluginSdk } from "@kilo-desktop/kernel";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";
import { Sessions } from "@kilo-desktop/plugin-sessions/contracts";

import { watchDomain } from "../attention/live-activity";
import { sessionOfChat } from "../attention/session-chats";
import { visibleSessionId } from "../attention/visits";
import { createChatNotifier, type AlertReason } from "./chat-notifier";
import { notificationPreferences } from "./notification-preferences";
import { playNotificationSound } from "./notification-sounds";

const ALERT_TITLES: Record<AlertReason, string> = {
	done: "Kilo finished",
	permission: "Kilo needs your approval",
	question: "Kilo has a question",
	error: "Kilo stopped with an error",
};

/**
 * Plays chat sounds and shows system notifications, in the main window only:
 * pop-out windows would otherwise double every cue. The app counts as focused
 * while any of its windows is; you are looking at a chat while the main
 * window is focused and shows the chat's session.
 */
export function startChatNotifier(sdk: PluginSdk): void {
	const windows = () => sdk.domains.get(KernelWindows)?.getState().windows;
	const windowFocused = () => {
		const record = windows()?.[sdk.windowId ?? "main"];
		return record ? record.focused : document.hasFocus();
	};
	const chats = () => sdk.domains.get(Conversations)?.getState().chats ?? {};
	const onEvent = createChatNotifier({
		chats,
		getMode: (cue) => notificationPreferences.get()[cue],
		isAppFocused: () => {
			const all = windows();
			return all ? Object.values(all).some((record) => record.focused) : document.hasFocus();
		},
		isViewingChat: (chatId) => {
			if (!windowFocused()) return false;
			const sessions = sdk.domains.get(Sessions)?.getState().sessions ?? [];
			const sessionId = sessionOfChat(sessions, chats(), chatId);
			return sessionId !== null && sessionId === visibleSessionId(sdk);
		},
		playSound: playNotificationSound,
		showNotification: (reason) => {
			void sdk.domains
				.get(KernelNotifications)
				?.methods.show({
					title: ALERT_TITLES[reason],
					body: "Open Kilo to continue.",
					// Our cue is the sound; the OS default would play on top of it.
					silent: true,
				})
				.catch(() => undefined);
		},
	});
	watchDomain(
		sdk,
		Conversations,
		() => undefined,
		(conversations) => {
			const offs = [
				conversations.on("turn-ended", (payload) => onEvent({ name: "turn-ended", payload })),
				conversations.on("permission-requested", (payload) =>
					onEvent({ name: "permission-requested", payload }),
				),
				conversations.on("question-requested", (payload) =>
					onEvent({ name: "question-requested", payload }),
				),
				conversations.on("updated", (payload) => onEvent({ name: "updated", payload })),
			];
			return () => {
				for (const off of offs) off();
			};
		},
	);
}
