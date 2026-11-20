/**
 * Anchoring saved passages in rendered text that re-renders (streamed,
 * windowed, folded): a passage is remembered by its quote — the exact text,
 * a little text either side and roughly where it started — and found again
 * in the text as it is now, as the W3C TextQuoteSelector does. Offsets are
 * into the roots' text: every text node of each root in document order,
 * concatenated (a reply's text parts, without the tools between them).
 */

export type TextRoots = Node | readonly Node[];
const rootsOf = (roots: TextRoots): readonly Node[] =>
	Array.isArray(roots) ? roots : [roots as Node];

const CONTEXT = 32;

export interface TextQuote {
	readonly exact: string;
	readonly prefix: string;
	readonly suffix: string;
	/** Where `exact` started in the root's text when saved. */
	readonly startHint: number;
}

interface TextSlice {
	readonly node: Text;
	readonly start: number;
}

/** The root's text and where each text node sits in it. */
export interface TextIndex {
	readonly text: string;
	readonly slices: readonly TextSlice[];
}

export function buildTextIndex(roots: TextRoots): TextIndex {
	const slices: TextSlice[] = [];
	let text = "";
	for (const root of rootsOf(roots)) {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const value = (node as Text).data;
			if (!value) continue;
			slices.push({ node: node as Text, start: text.length });
			text += value;
		}
	}
	return { text, slices };
}

/** The offset into the root's text of a DOM position inside it, or -1. */
function offsetOf(index: TextIndex, container: Node, offset: number): number {
	if (container.nodeType === Node.TEXT_NODE) {
		const slice = index.slices.find((candidate) => candidate.node === container);
		return slice ? slice.start + offset : -1;
	}
	// An element position falls between text nodes: it sits where the last
	// text node before it ends (0 when none comes before it).
	const point = document.createRange();
	point.setStart(container, offset);
	let end = 0;
	for (const slice of index.slices) {
		if (point.comparePoint(slice.node, 0) >= 0) break;
		end = slice.start + slice.node.data.length;
	}
	return end;
}

/** The quote for a range inside the roots, or null when it is outside them or empty. */
export function quoteOf(roots: TextRoots, range: Range): TextQuote | null {
	const inside = (node: Node) => rootsOf(roots).some((root) => root.contains(node));
	if (!inside(range.startContainer) || !inside(range.endContainer)) return null;
	const index = buildTextIndex(roots);
	const start = offsetOf(index, range.startContainer, range.startOffset);
	const end = offsetOf(index, range.endContainer, range.endOffset);
	if (start < 0 || end <= start) return null;
	const exact = index.text.slice(start, end);
	if (!exact.trim()) return null;
	return {
		exact,
		prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
		suffix: index.text.slice(end, end + CONTEXT),
		startHint: start,
	};
}

function commonSuffixLength(a: string, b: string): number {
	let count = 0;
	while (
		count < a.length &&
		count < b.length &&
		a[a.length - 1 - count] === b[b.length - 1 - count]
	)
		count += 1;
	return count;
}

function commonPrefixLength(a: string, b: string): number {
	let count = 0;
	while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
	return count;
}

/**
 * Where the quote is in the text now: among the occurrences of `exact`, the
 * one whose surroundings match the saved context best, nearest the saved
 * start on a tie. Null when the text no longer holds it.
 */
export function findQuote(text: string, quote: TextQuote): { start: number; end: number } | null {
	if (!quote.exact) return null;
	let best: { start: number; score: number } | null = null;
	for (let at = text.indexOf(quote.exact); at >= 0; at = text.indexOf(quote.exact, at + 1)) {
		const before = text.slice(Math.max(0, at - CONTEXT), at);
		const after = text.slice(at + quote.exact.length, at + quote.exact.length + CONTEXT);
		const context =
			commonSuffixLength(before, quote.prefix) + commonPrefixLength(after, quote.suffix);
		const score = context * 1000 - Math.min(999, Math.abs(at - quote.startHint) / 10);
		if (!best || score > best.score) best = { start: at, score };
	}
	return best ? { start: best.start, end: best.start + quote.exact.length } : null;
}

function positionAt(index: TextIndex, offset: number, preferNext: boolean): [Text, number] | null {
	for (let i = 0; i < index.slices.length; i += 1) {
		const slice = index.slices[i]!;
		const end = slice.start + slice.node.data.length;
		if (offset < end || (offset === end && !preferNext) || i === index.slices.length - 1) {
			if (offset < slice.start) return null;
			return [slice.node, Math.min(offset - slice.start, slice.node.data.length)];
		}
	}
	return null;
}

/** A DOM range over offsets of the root's text. */
export function rangeOf(index: TextIndex, start: number, end: number): Range | null {
	const from = positionAt(index, start, true);
	const to = positionAt(index, end, false);
	if (!from || !to) return null;
	const range = document.createRange();
	range.setStart(from[0], from[1]);
	range.setEnd(to[0], to[1]);
	return range;
}

/** The range a quote covers in the roots now, or null. */
export function locateQuote(roots: TextRoots, quote: TextQuote): Range | null {
	const index = buildTextIndex(roots);
	const found = findQuote(index.text, quote);
	return found ? rangeOf(index, found.start, found.end) : null;
}
