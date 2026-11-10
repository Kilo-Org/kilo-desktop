import type { PluginSdk } from "@kilo-desktop/kernel";

import { WorkSessions, type WorkSession } from "../../contracts";

/** Where origin kept pinned session (or chat) ids, in the main window's localStorage. */
export const LEGACY_PINS_STORAGE_KEY = "kilo-ui.session-list-pins:v1";
/** Set once origin's pins were handed over, so a later unpin sticks. */
export const LEGACY_PINS_HANDED_OVER_KEY = "kilo.work-sessions.legacy-pins-handed-over";

function readLegacyPins(): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_PINS_STORAGE_KEY) ?? "null");
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Main can't read the renderer's localStorage, so the main window pins the
 * work sessions origin's pins name (a work session id, or one of its chats')
 * through `setPinned`, once: as soon as any of them exists (origin's work
 * sessions are adopted in the background), and then marks the hand-over
 * done. Pins naming nothing that exists are dropped. Origin's key is left
 * alone so a downgrade still finds it.
 */
export function handOverLegacyPins(sdk: PluginSdk): void {
	if (localStorage.getItem(LEGACY_PINS_HANDED_OVER_KEY)) return;
	const wanted = new Set(readLegacyPins());
	if (wanted.size === 0) return;
	let stop: (() => void) | undefined;
	const named = (workSession: WorkSession) =>
		wanted.has(workSession.id) || workSession.chatIds.some((chatId) => wanted.has(chatId));
	sdk.domainObjects.track(WorkSessions, {
		added: (workSessions) => {
			const tryHandOver = ({ workSessions: list }: { workSessions: readonly WorkSession[] }) => {
				const toPin = list.filter(named);
				if (toPin.length === 0) return;
				localStorage.setItem(LEGACY_PINS_HANDED_OVER_KEY, "1");
				stop?.();
				stop = undefined;
				for (const workSession of toPin) {
					if (workSession.pinned) continue;
					void workSessions.methods
						.setPinned({ id: workSession.id, pinned: true })
						.catch(() => undefined);
				}
			};
			stop = workSessions.subscribe(tryHandOver);
			tryHandOver(workSessions.getState());
		},
		removed: () => {
			stop?.();
			stop = undefined;
		},
	});
	sdk.onDispose(() => stop?.());
}
