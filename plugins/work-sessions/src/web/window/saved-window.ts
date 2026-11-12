import type { WorkSessionsWindowState } from "../../contracts";

/**
 * What a window remembers across launches: only the list's workspace focus.
 * The open work session and work sessions view are not remembered, so every
 * launch starts on the New Session page.
 */
export type SavedWindow = Pick<WorkSessionsWindowState, "focus">;

export const savedWindowKey = (windowId: string) => `kilo.work-sessions.window:${windowId}`;
/** Where kilo.workbench, which this replaced, remembered it. */
const legacyWindowKey = (windowId: string) => `kilo.workbench.navigator:${windowId}`;
/** Origin's session list view, whose workspace filter a first run adopts. */
const ORIGIN_LIST_VIEW_KEY = "kilo-ui.session-list-view:v1";

const EMPTY: SavedWindow = { focus: null };
const text = (value: unknown) => (typeof value === "string" ? value : null);

function readJson(key: string): Record<string, unknown> | null {
	const raw = localStorage.getItem(key);
	if (raw === null) return null;
	const parsed: unknown = JSON.parse(raw);
	return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/**
 * A window's saved state. A first run takes kilo.workbench's saved focus,
 * else (with `adoptOrigin`) origin's session-list workspace filter.
 */
export function readSavedWindow(windowId: string, adoptOrigin = true): SavedWindow {
	try {
		const saved = readJson(savedWindowKey(windowId)) ?? readJson(legacyWindowKey(windowId));
		if (saved) return { focus: text(saved.focus) };
		if (!adoptOrigin) return EMPTY;
		return { focus: text(readJson(ORIGIN_LIST_VIEW_KEY)?.focus) || null };
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
