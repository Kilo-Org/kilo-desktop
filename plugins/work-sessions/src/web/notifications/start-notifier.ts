import { KernelNotifications, KernelWindows, type PluginSdk } from "@kilo-desktop/kernel";
import { Chats } from "@kilo-desktop/plugin-core/contracts";

import { PermissionAutoAnswer, WorkSessions } from "../../contracts";
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
 * window is focused and shows the chat's session. A permission request
 * plays nothing when a `permission-auto-answer` contribution takes it, or it
 * was answered before it could be read.
 */
export function startChatNotifier(sdk: PluginSdk): void {
	const windows = () => sdk.domainObjects.get(KernelWindows)?.getState().windows;
	const windowFocused = () => {
		const record = windows()?.[sdk.windowId ?? "main"];
		return record ? record.focused : document.hasFocus();
	};
	const chats = () => sdk.domainObjects.get(Chats)?.getState().chats ?? {};
	const lifetime = new AbortController();
	sdk.onDispose(() => lifetime.abort());
	const onEvent = createChatNotifier({
		chats,
		signal: lifetime.signal,
		isAnsweredForPerson: async (chatId, permissionId) => {
			const handle = sdk.domainObjects.get(Chats);
			if (!handle) return false;
			const requests = await handle.methods.permissionRequests({ id: chatId });
			const request = requests.find((candidate) => candidate.id === permissionId);
			if (!request) return true;
			return sdk.extensions
				.list(PermissionAutoAnswer)
				.some((contribution) => contribution.implementation?.(request) === true);
		},
		getMode: (cue) => notificationPreferences.get()[cue],
		isAppFocused: () => {
			const all = windows();
			return all ? Object.values(all).some((record) => record.focused) : document.hasFocus();
		},
		isViewingChat: (chatId) => {
			if (!windowFocused()) return false;
			const sessions = sdk.domainObjects.get(WorkSessions)?.getState().workSessions ?? [];
			const sessionId = sessionOfChat(sessions, chats(), chatId);
			return sessionId !== null && sessionId === visibleSessionId(sdk);
		},
		playSound: playNotificationSound,
		showNotification: (reason) => {
			void sdk.domainObjects
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
		Chats,
		() => undefined,
		(chatsHandle) => {
			const offs = [
				chatsHandle.on("work-completed", (payload) => onEvent({ name: "work-completed", payload })),
				chatsHandle.on("turn-ended", (payload) => onEvent({ name: "turn-ended", payload })),
				chatsHandle.on("permission-requested", (payload) =>
					onEvent({ name: "permission-requested", payload }),
				),
				chatsHandle.on("question-requested", (payload) =>
					onEvent({ name: "question-requested", payload }),
				),
				chatsHandle.on("updated", (payload) => onEvent({ name: "updated", payload })),
			];
			return () => {
				for (const off of offs) off();
			};
		},
	);
}
