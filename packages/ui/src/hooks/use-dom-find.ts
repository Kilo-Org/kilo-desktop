import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
	findRanges,
	highlightConstructor,
	highlightRegistry,
	isFindIgnored,
	scrollRangeIntoView,
} from "../lib/dom-find.js";

const MATCH_HIGHLIGHT = "kilo-find";
const ACTIVE_HIGHLIGHT = "kilo-find-active";
const RECOMPUTE_DEBOUNCE_MS = 100;
// Caps how long continuous mutations (a streaming reply) can defer a recompute,
// so the count and highlights keep up while text arrives.
const RECOMPUTE_MAX_WAIT_MS = 300;

// A single find session is visible per window at a time: opening a bar in one
// pane closes any other open bar. That keeps the shared `::highlight()` names
// unambiguous without minting per-pane highlight names (which would need
// dynamically injected CSS rules). The pointer is module-scoped because panes
// are independent React subtrees with no shared ancestor to coordinate through.
let currentSession: { close: () => void } | null = null;

function startsAtOrAfter(range: Range, anchor: Range): boolean {
	try {
		return range.compareBoundaryPoints(Range.START_TO_START, anchor) >= 0;
	} catch {
		// The anchor's subtree left the document, so positions can't be compared.
		return false;
	}
}

const MAX_SELECTION_QUERY_LENGTH = 200;

/** The current selection when it is a short, single line of text inside `searchRoot`. */
function selectedSearchText(searchRoot: Element | null): { text: string; range: Range } | null {
	const selection = window.getSelection();
	if (!searchRoot || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const range = selection.getRangeAt(0);
	const container = range.commonAncestorContainer;
	if (!searchRoot.contains(container) || isFindIgnored(container)) return null;
	const text = range.toString().trim();
	if (!text || text.length > MAX_SELECTION_QUERY_LENGTH || text.includes("\n")) return null;
	return { text, range };
}

/**
 * The match to make active after a recompute: the first one at or after the
 * previous active match, wrapping to the first match.
 */
function anchoredIndex(ranges: readonly Range[], anchor: Range | null): number {
	if (ranges.length === 0) return -1;
	if (!anchor) return 0;
	const index = ranges.findIndex((range) => startsAtOrAfter(range, anchor));
	return index === -1 ? 0 : index;
}

export interface DomFindController {
	readonly open: boolean;
	/** Kept across close/reopen, like a browser's find bar. */
	readonly query: string;
	readonly caseSensitive: boolean;
	readonly total: number;
	/** Zero-based index of the active match, or -1 when there are none. */
	readonly activeIndex: number;
	setQuery(value: string): void;
	toggleCaseSensitive(): void;
	/** Opens (or keeps open) this pane's bar; a short text selection in the pane becomes the query. */
	openBar(): void;
	closeBar(): void;
	next(): void;
	prev(): void;
}

export interface UseDomFindOptions {
	readonly rootRef: RefObject<HTMLElement | null>;
	/** CSS selector (relative to root) for the subtree to search; defaults to the root itself. */
	readonly searchRootSelector?: string;
}

/**
 * Owns the find state for one DOM pane: query, options, match ranges, the
 * active match, CSS highlight registration, scroll-into-view, and teardown.
 * `rootRef` is the pane's find scope; the searchable subtree is `rootRef` or
 * the first `searchRootSelector` descendant within it.
 */
export function useDomFind({ rootRef, searchRootSelector }: UseDomFindOptions): DomFindController {
	const [open, setOpen] = useState(false);
	const [query, setQueryState] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [matches, setMatches] = useState<Range[]>([]);
	const [activeIndex, setActiveIndex] = useState(-1);

	// The active match as a live Range: the DOM keeps it positioned through
	// edits, so a recompute during streaming re-selects the same match.
	const activeRangeRef = useRef<Range | null>(null);
	// Set by user intent (typing, toggling case) so only the recompute that
	// follows it scrolls. Recomputes caused by content changes never move the
	// viewport, otherwise streaming would keep yanking the reader back.
	const revealPendingRef = useRef(false);
	// Bumped when a selection seeds the search, so the recompute runs (and
	// scrolls) right away even when the open bar's query is unchanged.
	const [seedVersion, setSeedVersion] = useState(0);
	const sessionHandleRef = useRef<{ close: () => void }>({ close: () => {} });

	const resolveSearchRoot = useCallback((): Element | null => {
		const root = rootRef.current;
		if (!root) return null;
		if (!searchRootSelector) return root;
		return root.querySelector(searchRootSelector);
	}, [rootRef, searchRootSelector]);

	const clearHighlights = useCallback(() => {
		const registry = highlightRegistry();
		registry?.delete(MATCH_HIGHLIGHT);
		registry?.delete(ACTIVE_HIGHLIGHT);
	}, []);

	const closeBar = useCallback(() => {
		if (currentSession === sessionHandleRef.current) currentSession = null;
		setOpen(false);
		setMatches([]);
		setActiveIndex(-1);
		activeRangeRef.current = null;
		revealPendingRef.current = false;
		clearHighlights();
	}, [clearHighlights]);

	// Keep the module-scoped session pointer wired to the latest closeBar.
	useEffect(() => {
		sessionHandleRef.current.close = closeBar;
	}, [closeBar]);

	const openBar = useCallback(() => {
		if (currentSession && currentSession !== sessionHandleRef.current) currentSession.close();
		currentSession = sessionHandleRef.current;
		const selected = selectedSearchText(resolveSearchRoot());
		if (selected) {
			// Start at the selected occurrence rather than the first match.
			activeRangeRef.current = selected.range.cloneRange();
			revealPendingRef.current = true;
			setQueryState(selected.text);
			setSeedVersion((version) => version + 1);
		}
		setOpen(true);
	}, [resolveSearchRoot]);

	const recompute = useCallback(() => {
		const searchRoot = resolveSearchRoot();
		const ranges = searchRoot ? findRanges(searchRoot, query, { caseSensitive }) : [];
		const index = anchoredIndex(ranges, activeRangeRef.current);
		const active = ranges[index] ?? null;
		activeRangeRef.current = active;
		// While nothing matches (e.g. an empty query), content changes keep the
		// same state, so streaming doesn't re-render the bar on every batch.
		setMatches((previous) => (previous.length === 0 && ranges.length === 0 ? previous : ranges));
		setActiveIndex(index);
		if (revealPendingRef.current) {
			revealPendingRef.current = false;
			if (active) scrollRangeIntoView(active);
		}
	}, [caseSensitive, query, resolveSearchRoot]);

	// Recompute on open / query / option change (debounced) and whenever the
	// searched content mutates (e.g. streaming), preserving the query.
	useEffect(() => {
		if (!open) return;
		const searchRoot = resolveSearchRoot();
		let timer: number | undefined;
		let pendingSince: number | null = null;
		const run = () => {
			pendingSince = null;
			recompute();
		};
		const schedule = () => {
			const now = performance.now();
			pendingSince ??= now;
			const untilMaxWait = RECOMPUTE_MAX_WAIT_MS - (now - pendingSince);
			window.clearTimeout(timer);
			timer = window.setTimeout(run, Math.max(0, Math.min(RECOMPUTE_DEBOUNCE_MS, untilMaxWait)));
		};
		schedule();
		const observer = new MutationObserver((records) => {
			if (records.some((record) => !isFindIgnored(record.target))) schedule();
		});
		if (searchRoot) {
			observer.observe(searchRoot, { childList: true, subtree: true, characterData: true });
		}
		return () => {
			window.clearTimeout(timer);
			observer.disconnect();
		};
	}, [open, recompute, resolveSearchRoot, seedVersion]);

	// Register the computed ranges with the CSS highlight registry. The active
	// match is painted via a separate highlight so it can be styled distinctly.
	useEffect(() => {
		if (!open) return;
		const registry = highlightRegistry();
		const HighlightImpl = highlightConstructor();
		if (!registry || !HighlightImpl) return;
		if (matches.length === 0) {
			registry.delete(MATCH_HIGHLIGHT);
			registry.delete(ACTIVE_HIGHLIGHT);
			return;
		}
		const inactive = matches.filter((_, index) => index !== activeIndex);
		registry.set(MATCH_HIGHLIGHT, new HighlightImpl(...inactive));
		if (activeIndex >= 0 && activeIndex < matches.length) {
			registry.set(ACTIVE_HIGHLIGHT, new HighlightImpl(matches[activeIndex] as Range));
		} else {
			registry.delete(ACTIVE_HIGHLIGHT);
		}
	}, [open, matches, activeIndex]);

	// Teardown on unmount. The highlight names are shared by every pane in the
	// window, so only the session that owns them may clear them.
	useEffect(() => {
		return () => {
			if (currentSession !== sessionHandleRef.current) return;
			currentSession = null;
			clearHighlights();
		};
	}, [clearHighlights]);

	const setQuery = useCallback((value: string) => {
		revealPendingRef.current = true;
		setQueryState(value);
	}, []);
	const toggleCaseSensitive = useCallback(() => {
		revealPendingRef.current = true;
		setCaseSensitive((value) => !value);
	}, []);
	const goTo = useCallback(
		(index: number) => {
			const range = matches[index];
			if (!range) return;
			activeRangeRef.current = range;
			setActiveIndex(index);
			scrollRangeIntoView(range);
		},
		[matches],
	);
	const next = useCallback(() => {
		if (matches.length > 0) goTo((activeIndex + 1) % matches.length);
	}, [activeIndex, goTo, matches.length]);
	const prev = useCallback(() => {
		if (matches.length > 0) goTo((activeIndex - 1 + matches.length) % matches.length);
	}, [activeIndex, goTo, matches.length]);

	return {
		open,
		query,
		caseSensitive,
		total: matches.length,
		activeIndex,
		setQuery,
		toggleCaseSensitive,
		openBar,
		closeBar,
		next,
		prev,
	};
}
