import { useSyncExternalStore } from "react";

import type { ChatCue, NotificationMode } from "./chat-notifier";

/*
 * Per-device notification modes in localStorage. Origin kept them in a
 * zustand-persisted record (`{state: {done, needsYou}}`); the first read
 * adopts it.
 */

export const NOTIFICATION_PREFERENCES_STORAGE_KEY = "kilo.workbench.notifications:v1";
export const ORIGIN_NOTIFICATION_PREFERENCES_STORAGE_KEY = "kilo-ui:chat-notifications:v2";

export type NotificationPreferences = Readonly<Record<ChatCue, NotificationMode>>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
	done: "smart",
	needsYou: "smart",
};

const isMode = (value: unknown): value is NotificationMode =>
	value === "off" || value === "smart" || value === "always";

function parse(raw: string | null): Partial<Record<ChatCue, unknown>> | undefined {
	if (raw === null) return undefined;
	try {
		const value: unknown = JSON.parse(raw);
		return typeof value === "object" && value !== null ? value : {};
	} catch {
		return {};
	}
}

function normalize(record: Partial<Record<ChatCue, unknown>>): NotificationPreferences {
	return {
		done: isMode(record.done) ? record.done : DEFAULT_NOTIFICATION_PREFERENCES.done,
		needsYou: isMode(record.needsYou) ? record.needsYou : DEFAULT_NOTIFICATION_PREFERENCES.needsYou,
	};
}

function read(): NotificationPreferences {
	try {
		const own = parse(localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY));
		if (own) return normalize(own);
		const origin = parse(localStorage.getItem(ORIGIN_NOTIFICATION_PREFERENCES_STORAGE_KEY)) as
			| { state?: Partial<Record<ChatCue, unknown>> }
			| undefined;
		const adopted = normalize(origin?.state ?? {});
		localStorage.setItem(NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify(adopted));
		return adopted;
	} catch {
		return DEFAULT_NOTIFICATION_PREFERENCES;
	}
}

let preferences: NotificationPreferences | undefined;
const listeners = new Set<() => void>();

export const notificationPreferences = {
	get: (): NotificationPreferences => (preferences ??= read()),
	setMode(cue: ChatCue, mode: NotificationMode): void {
		preferences = { ...notificationPreferences.get(), [cue]: mode };
		try {
			localStorage.setItem(NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
		} catch {
			// Kept in memory when storage is unavailable.
		}
		for (const listener of listeners) listener();
	},
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	/** Reads storage again, e.g. when the plugin activates. */
	reload(): void {
		preferences = undefined;
		for (const listener of listeners) listener();
	},
};

export function useNotificationPreferences(): NotificationPreferences {
	return useSyncExternalStore((onChange) => {
		listeners.add(onChange);
		return () => listeners.delete(onChange);
	}, notificationPreferences.get);
}
