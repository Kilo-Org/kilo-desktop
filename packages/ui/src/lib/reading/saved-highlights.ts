/**
 * Saved text painted in place with the CSS Custom Highlight API under one
 * name, `kilo-saved` (styled in reading.css as an inverted highlight: the
 * text colour as background, the background colour as text). Every painter
 * in the window (a transcript, the Focus reader) registers its own ranges;
 * the window's highlight is their union. Painting never touches the DOM, so
 * it survives re-renders of the text, which are repainted by their painter.
 * Below the find bar's highlights in priority.
 */

const NAME = "kilo-saved";
const PRIORITY = -1;

const painters = new Map<symbol, readonly Range[]>();

function supported(): boolean {
	return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

function repaint(): void {
	if (!supported()) return;
	const ranges = [...painters.values()].flat();
	if (ranges.length === 0) {
		CSS.highlights.delete(NAME);
		return;
	}
	const highlight = new Highlight(...ranges);
	highlight.priority = PRIORITY;
	CSS.highlights.set(NAME, highlight);
}

/** A painter of saved ranges; call `paint` with its current ranges, `dispose` when it goes. */
export function createSavedPainter() {
	const id = Symbol("saved-painter");
	return {
		paint(ranges: readonly Range[]): void {
			if (ranges.length === 0 && !painters.has(id)) return;
			if (ranges.length === 0) painters.delete(id);
			else painters.set(id, ranges);
			repaint();
		},
		dispose(): void {
			if (painters.delete(id)) repaint();
		},
	};
}

export type SavedPainter = ReturnType<typeof createSavedPainter>;

/** The ranges currently painted (for tests). */
export function paintedSavedRanges(): readonly Range[] {
	return [...painters.values()].flat();
}
