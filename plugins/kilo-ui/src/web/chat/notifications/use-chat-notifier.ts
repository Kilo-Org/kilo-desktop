import { useMemo } from "react";

import type { SDK } from "@kilo-desktop/feature-sdk";

import { isChatRoutePath } from "../chat-navigation.js";
import type { SessionActivityStore } from "../../session/activity/session-activity-store.js";
import { createChatNotifier, type AlertReason } from "./chat-notifier.js";
import { useNotificationPreferences } from "./notification-preferences.js";
import { playNotificationSound } from "./notification-sounds.js";

const ALERT_TITLES: Record<AlertReason, string> = {
	done: "Kilo finished",
	permission: "Kilo needs your approval",
	question: "Kilo has a question",
	error: "Kilo stopped with an error",
};

/**
 * The live-event handler that plays chat sounds and system notifications.
 * Undefined outside the main window: popped-out pane windows run their own
 * provider tree and would otherwise double every notification.
 */
export function useChatNotifier(sdk: SDK, sessionActivity: SessionActivityStore) {
	const isMainWindow = sdk.shell.windowRole === "main";
	return useMemo(() => {
		if (!isMainWindow) return undefined;
		return createChatNotifier({
			sessions: () => sessionActivity.getState().sessions,
			getMode: (cue) => useNotificationPreferences.getState()[cue],
			isAppFocused: () => document.hasFocus(),
			isViewingChat: (sessionId) =>
				document.hasFocus() &&
				isChatRoutePath(sdk.location.peek().path) &&
				sessionActivity.getState().openSessionId === sessionId,
			playSound: playNotificationSound,
			showNotification: (reason) => {
				void sdk.notifications
					.show({
						title: ALERT_TITLES[reason],
						message: "Open Kilo to continue.",
						type: reason === "error" ? "error" : "info",
						// Our cue is the sound; the OS default would play on top of it.
						silent: true,
					})
					.catch(() => undefined);
			},
		});
	}, [isMainWindow, sdk, sessionActivity]);
}
