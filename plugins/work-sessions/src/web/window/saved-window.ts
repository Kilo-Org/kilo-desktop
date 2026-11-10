import type { WorkSessionsWindowState } from "../../contracts";

export type SavedWindow = Pick<WorkSessionsWindowState, "focus" | "activeWorkSessionId" | "view">;

/** Where a window remembers what it was looking at. */
export const savedWindowKey = (windowId: string) => `kilo.work-sessions.window:${windowId}`;
/** Where kilo.workbench, which this replaced, remembered it (`activeSessionId`). */
const legacyWindowKey = (windowId: string) => `kilo.workbench.navigator:${windowId}`;
/** Origin's session list view, whose workspace filter a first run adopts. */
const ORIGIN_LIST_VIEW_KEY = "kilo-ui.session-list-view:v1";

const EMPTY: SavedWindow = { focus: null, activeWorkSessionId: null, view: null };
const text = (value: unknown) => (typeof value === "string" ? value : null);

function readJson(key: string): Record<string, unknown> | null {
	const raw = localStorage.getItem(key);
	if (raw === null) return null;
	const parsed: unknown = JSON.parse(raw);
	return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/**
 * A window's saved state. A first run takes kilo.workbench's saved state,
 * else (with `adoptOrigin`) origin's session-list workspace filter.
 */
export function readSavedWindow(windowId: string, adoptOrigin = true): SavedWindow {
	try {
		const saved = readJson(savedWindowKey(windowId));
		if (saved) {
			return {
				focus: text(saved.focus),
				activeWorkSessionId: text(saved.activeWorkSessionId),
				view: text(saved.view),
			};
		}
		const legacy = readJson(legacyWindowKey(windowId));
		if (legacy) {
			return {
				focus: text(legacy.focus),
				activeWorkSessionId: text(legacy.activeSessionId),
				view: text(legacy.view),
			};
		}
		if (!adoptOrigin) return EMPTY;
		return { ...EMPTY, focus: text(readJson(ORIGIN_LIST_VIEW_KEY)?.focus) || null };
	} catch {
		return EMPTY;
	}
}

export function writeSavedWindow(windowId: string, state: SavedWindow): void {
	try {
		localStorage.setItem(savedWindowKey(windowId), JSON.stringify(state));
	} catch {
		// The window keeps its state in memory when storage is unavailable.
	}
}
