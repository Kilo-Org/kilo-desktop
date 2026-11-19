import type { MediaItem } from "../../contracts";

/** The most hand-offs a window keeps; one per viewer it showed recently. */
const MAX_HANDOFFS = 4;

/**
 * Items this window just showed main, by viewer key, with the revision main
 * gave them. A Viewer pane in the same window takes them instead of fetching
 * the same bytes back from main; a pane in another window (a pop-out) finds
 * nothing here and fetches. Each window has its own map, and a key always
 * holds the latest items this window showed for it.
 */
const handoffs = new Map<
	string,
	{ readonly revision: number; readonly items: readonly MediaItem[] }
>();

export function handOffViewerItems(
	key: string,
	revision: number,
	items: readonly MediaItem[],
): void {
	handoffs.delete(key);
	handoffs.set(key, { revision, items });
	for (const oldest of handoffs.keys()) {
		if (handoffs.size <= MAX_HANDOFFS) break;
		handoffs.delete(oldest);
	}
}

/** The items handed off for `key` at exactly `revision`, left in place. */
export function peekViewerItems(key: string, revision: number): readonly MediaItem[] | null {
	const entry = handoffs.get(key);
	return entry?.revision === revision ? entry.items : null;
}

/**
 * The items handed off for `key` at exactly `revision`, once: taking them
 * removes them, so a closed pane doesn't keep its images alive here. An
 * older hand-off is dropped; a newer one is left for the pane to reach.
 */
export function takeViewerItems(key: string, revision: number): readonly MediaItem[] | null {
	const entry = handoffs.get(key);
	if (!entry || entry.revision > revision) return null;
	handoffs.delete(key);
	return entry.revision === revision ? entry.items : null;
}

export function dropViewerHandoff(key: string): void {
	handoffs.delete(key);
}
