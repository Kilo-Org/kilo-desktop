import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ChatCue } from "./chat-notifier.js";

export const NOTIFICATION_PREFERENCES_STORAGE_KEY = "kilo-ui:chat-notifications:v2";

/**
 * When a cue notifies: its sound, plus a system banner while Kilo is in the
 * background. `smart` skips the chat you're already looking at.
 */
export type NotificationMode = "off" | "smart" | "always";

/** Per-device notification modes, persisted to localStorage. */
export const useNotificationPreferences = create<
	Record<ChatCue, NotificationMode> & {
		setMode: (cue: ChatCue, mode: NotificationMode) => void;
	}
>()(
	persist(
		(set) => ({
			done: "smart",
			needsYou: "smart",
			setMode: (cue, mode) => set({ [cue]: mode }),
		}),
		{ name: NOTIFICATION_PREFERENCES_STORAGE_KEY },
	),
);
