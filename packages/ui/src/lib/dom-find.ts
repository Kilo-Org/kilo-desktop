// Pure DOM helpers for the shared find bar. These build the `Range`s the CSS
// Custom Highlight API paints and expose a typed, feature-detected view of
// `CSS.highlights` / `Highlight` so callers avoid depending on the DOM lib's
// highlight typings directly.

interface HighlightRegistryLike {
	set(name: string, highlight: object): void;
	delete(name: string): void;
	has(name: string): boolean;
}

type HighlightConstructor = new (...ranges: Range[]) => object;

/** The live `CSS.highlights` registry, or `null` when unsupported. */
export function highlightRegistry(): HighlightRegistryLike | null {
	const css = (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS;
	return css?.highlights ?? null;
}

/** The `Highlight` constructor, or `null` when unsupported. */
export function highlightConstructor(): HighlightConstructor | null {
	return (globalThis as { Highlight?: HighlightConstructor }).Highlight ?? null;
}

// Elements that flow inline with the surrounding text. Their text joins the
// enclosing block's text, so a phrase can match across inline formatting
// (`**bold**`, `inline code`, links) and syntax-highlight token spans. Any
// other element starts a new block, so text never joins across paragraphs.
const INLINE_TAGS = new Set([
	"A",
	"ABBR",
	"B",
	"BDI",
	"BDO",
	"CITE",
	"CODE",
	"DATA",
	"DEL",
	"DFN",
	"EM",
	"I",
	"INS",
	"KBD",
	"MARK",
	"Q",
	"S",
	"SAMP",
	"SMALL",
	"SPAN",
	"STRONG",
	"SUB",
	"SUP",
	"TIME",
	"U",
	"VAR",
]);

/** Content under `[data-find-ignore]` (such as the find bar itself) is never searched. */
const FIND_IGNORE_SELECTOR = "[data-find-ignore]";

/** True when `node` sits inside content the find bar must not search or react to. */
export function isFindIgnored(node: Node): boolean {
	const element = node instanceof Element ? node : node.parentElement;
	return element?.closest(FIND_IGNORE_SELECTOR) != null;
}

// Text that has a box but is never painted: Tailwind's visually-hidden labels
// (icon-button tooltips, task status). `checkVisibility` can't see the clip, and
// every such label in the app uses this class. Opacity is deliberately not
// checked: messages fade in from opacity 0, and CSS animations don't trigger a
// recompute, so fresh text would stay unsearchable.
const SCREEN_READER_ONLY_SELECTOR = ".sr-only";

function renderedTextNodes(root: Node): Text[] {
	// Many text nodes share a parent; check each parent's visibility once.
	const visibleByParent = new Map<Element, boolean>();
	const isRendered = (node: Node): boolean => {
		const parent = node.parentElement;
		if (!node.nodeValue || !parent) return false;
		let visible = visibleByParent.get(parent);
		if (visible === undefined) {
			visible =
				parent.tagName !== "SCRIPT" &&
				parent.tagName !== "STYLE" &&
				parent.closest(
					`[aria-hidden='true'],${FIND_IGNORE_SELECTOR},${SCREEN_READER_ONLY_SELECTOR}`,
				) === null &&
				// display:none (incl. [hidden] and collapsed sections), visibility:hidden.
				parent.checkVisibility({ visibilityProperty: true });
			visibleByParent.set(parent, visible);
		}
		return visible;
	};
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => (isRendered(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
	});
	const nodes: Text[] = [];
	for (let current = walker.nextNode(); current; current = walker.nextNode()) {
		nodes.push(current as Text);
	}
	return nodes;
}

function blockOf(node: Text): Element | null {
	let element = node.parentElement;
	while (element && INLINE_TAGS.has(element.tagName)) element = element.parentElement;
	return element;
}

/** The characters JavaScript's `\s` matches, tested without a regex per character. */
function isWhitespace(code: number): boolean {
	return (
		code === 0x20 ||
		(code >= 0x09 && code <= 0x0d) ||
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}

/**
 * Lowercases one code point. Text and query are both folded this way so they
 * always agree; whole-string lowercasing is context-sensitive (a word-final Σ
 * becomes ς). A code point whose lowercase is longer (e.g. "İ") is kept as-is,
 * so every searchable code unit still maps back to one DOM offset.
 */
function foldCodePoint(code: number): string {
	if (code < 0x80) return String.fromCharCode(code >= 0x41 && code <= 0x5a ? code + 0x20 : code);
	const char = String.fromCodePoint(code);
	const lower = char.toLowerCase();
	return lower.length === char.length ? lower : char;
}

/**
 * One block's searchable text: its text nodes' contents in order, case-folded
 * when needed, with each whitespace run collapsed to one space as it renders.
 * Node `i` contributes the text from `starts[i]`. Its character `k` sits at DOM
 * offset `shifts[i] + k`, unless collapsing skipped characters inside the node;
 * then `offsets[i][k]` holds it. That is rare, so those tables are built lazily
 * and the common case allocates nothing per character.
 */
interface BlockText {
	text: string;
	readonly nodes: Text[];
	readonly starts: number[];
	readonly shifts: number[];
	readonly offsets: (number[] | null)[];
}

function blockTexts(root: Node, caseSensitive: boolean): BlockText[] {
	const blocks: BlockText[] = [];
	let current: BlockText | null = null;
	let currentBlock: Element | null = null;
	let lastWasSpace = true;
	for (const node of renderedTextNodes(root)) {
		const block = blockOf(node);
		if (!current || block !== currentBlock) {
			current = { text: "", nodes: [], starts: [], shifts: [], offsets: [] };
			blocks.push(current);
			currentBlock = block;
			lastWasSpace = true;
		}
		const value = node.nodeValue ?? "";
		let text = "";
		let shift = 0;
		let offsets: number[] | null = null;
		for (let offset = 0; offset < value.length;) {
			const code = value.codePointAt(offset) ?? 0;
			const width = code > 0xffff ? 2 : 1;
			const space = isWhitespace(code);
			if (!(space && lastWasSpace)) {
				// Same length as the source code point, so offsets stay one-to-one.
				const piece = space
					? " "
					: caseSensitive
						? value.slice(offset, offset + width)
						: foldCodePoint(code);
				if (text.length === 0) shift = offset;
				else if (!offsets && offset !== shift + text.length) {
					offsets = Array.from({ length: text.length }, (_, index) => shift + index);
				}
				if (offsets) for (let unit = 0; unit < piece.length; unit += 1) offsets.push(offset + unit);
				text += piece;
			}
			lastWasSpace = space;
			offset += width;
		}
		current.nodes.push(node);
		current.starts.push(current.text.length);
		current.shifts.push(shift);
		current.offsets.push(offsets);
		current.text += text;
	}
	return blocks;
}

/**
 * The DOM position of character `index` of `block.text`. Matches are visited
 * in order, so the node search resumes from `fromNode` instead of restarting.
 */
function locate(
	block: BlockText,
	index: number,
	fromNode: number,
): { node: number; offset: number } {
	let node = fromNode;
	while (node + 1 < block.starts.length && (block.starts[node + 1] ?? Infinity) <= index) {
		node += 1;
	}
	const local = index - (block.starts[node] ?? 0);
	const offsets = block.offsets[node];
	return { node, offset: offsets ? (offsets[local] ?? 0) : (block.shifts[node] ?? 0) + local };
}

/**
 * The query in the same form as the searched text: whitespace runs collapsed
 * by the same `isWhitespace` rule, then case-folded per code point, so the
 * two sides can't drift apart.
 */
function normalizeQuery(query: string, caseSensitive: boolean): string {
	let normalized = "";
	let lastWasSpace = false;
	for (const char of query) {
		const code = char.codePointAt(0) ?? 0;
		const space = isWhitespace(code);
		if (space && lastWasSpace) continue;
		lastWasSpace = space;
		normalized += space ? " " : caseSensitive ? char : foldCodePoint(code);
	}
	return normalized;
}

export interface FindRangeOptions {
	readonly caseSensitive?: boolean;
}

/**
 * Substring matches of `query` within `root`, as `Range`s in document order.
 * Whitespace-only or empty queries match nothing. Text is matched per block,
 * across inline elements, with whitespace runs treated as one space — close
 * to how the browser's own find-in-page reads rendered text.
 */
export function findRanges(root: Element, query: string, options: FindRangeOptions = {}): Range[] {
	const caseSensitive = options.caseSensitive ?? false;
	const needle = normalizeQuery(query, caseSensitive);
	// Empty, or whitespace only (which normalizes to a single space).
	if (needle === "" || needle === " ") return [];
	const ranges: Range[] = [];
	for (const block of blockTexts(root, caseSensitive)) {
		let cursor = 0;
		for (
			let start = block.text.indexOf(needle);
			start !== -1;
			start = block.text.indexOf(needle, start + needle.length)
		) {
			const first = locate(block, start, cursor);
			const last = locate(block, start + needle.length - 1, first.node);
			cursor = first.node;
			const startNode = block.nodes[first.node];
			const endNode = block.nodes[last.node];
			if (!startNode || !endNode) continue;
			const range = document.createRange();
			range.setStart(startNode, first.offset);
			range.setEnd(endNode, last.offset + 1);
			ranges.push(range);
		}
	}
	return ranges;
}

function isScrollContainer(element: Element): boolean {
	const style = getComputedStyle(element);
	const scrollsY =
		/auto|scroll/u.test(style.overflowY) && element.scrollHeight > element.clientHeight;
	const scrollsX =
		/auto|scroll/u.test(style.overflowX) && element.scrollWidth > element.clientWidth;
	return scrollsY || scrollsX;
}

/**
 * Scrolls each scrollable ancestor so `range` is visible: centred vertically
 * on the match itself (not its possibly very tall parent element) and moved
 * horizontally only when it is out of view, e.g. in a wide code block.
 * Unlike `Element.scrollIntoView`, `overflow: hidden` ancestors are left
 * alone, so pane layouts never shift.
 */
export function scrollRangeIntoView(range: Range): void {
	const initial = range.getBoundingClientRect();
	if (initial.width === 0 && initial.height === 0) return;
	for (let element = range.startContainer.parentElement; element; element = element.parentElement) {
		if (!isScrollContainer(element)) continue;
		const box = element.getBoundingClientRect();
		const rect = range.getBoundingClientRect();
		element.scrollTop += rect.top - box.top - (element.clientHeight - rect.height) / 2;
		if (rect.left < box.left || rect.right > box.left + element.clientWidth) {
			element.scrollLeft += rect.left - box.left - (element.clientWidth - rect.width) / 2;
		}
	}
}
