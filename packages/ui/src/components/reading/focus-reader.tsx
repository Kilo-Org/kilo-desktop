import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";

import {
	blockBox,
	blockIndexAt,
	blockIndexOf,
	readingBlocks,
	type ReadingBlock,
} from "@kilo-desktop/ui/lib/reading/blocks";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { useStableCallback } from "@kilo-desktop/ui/hooks/use-stable";
import { blockOpacity } from "@kilo-desktop/ui/lib/reading/dimming";
import type { ReadingThemeStyle } from "@kilo-desktop/ui/lib/reading/reading-theme";
import type { FocusMovesWith } from "@kilo-desktop/ui/lib/reading/settings";
import {
	FOCUS_COLUMN_WIDTH,
	type ReadingTypography,
} from "@kilo-desktop/ui/lib/reading/typography";
import type { ResolvedColorScheme } from "@kilo-desktop/ui/themes/theme-tokens";
import { cn } from "@kilo-desktop/ui/lib/utils";

import "./reading.css";
import { FocusReaderContext, type FocusReaderContextValue } from "./focus-context";

export type FocusMoveSource = "keys" | "scroll" | "pointer";
export type FocusExitRequest = "escape" | "exit-button";

/** What happened during one visit to Focus, for content-free telemetry. */
export interface FocusVisitSummary {
	readonly durationSeconds: number;
	/** Seconds with an interaction in the 30 seconds before. */
	readonly activeSeconds: number;
	readonly blockCount: number;
	readonly blocksVisited: number;
	/** How far through the content the reader got (0–100). */
	readonly maxBlockPct: number;
	readonly movesByKeys: number;
	readonly movesByScroll: number;
	readonly movesByPointer: number;
	readonly copies: number;
	readonly typingAttempts: number;
	readonly findAttempts: number;
}

export interface FocusReaderProps {
	readonly theme: ReadingThemeStyle;
	readonly scheme: ResolvedColorScheme;
	readonly typography: ReadingTypography;
	readonly dimming: number;
	readonly movesWith: FocusMovesWith;
	/**
	 * The block to start on, or how to find it among the blocks once the
	 * content is in (a whole chat starts on one reply's paragraph); the
	 * content's first block when out of range.
	 */
	readonly initialBlock: number | ((blocks: readonly ReadingBlock[]) => number);
	readonly onExit: (request: FocusExitRequest) => void;
	readonly onFocusChange?: (index: number, block: ReadingBlock | undefined) => void;
	/** Text copied inside the reader (for excerpt matching; never stored as text). */
	readonly onCopy?: (text: string) => void;
	/** Called once when the reader goes away, however it was closed. */
	readonly onVisitEnd?: (summary: FocusVisitSummary) => void;
	/** The Aa control, bottom right. */
	readonly control?: ReactNode;
	/**
	 * Receives the bottom-centre slot a toast portals into; the hint hides
	 * while the slot holds anything.
	 */
	readonly toastSlot?: (slot: HTMLElement | null) => void;
	/** Extra layers over the content (a selection menu). */
	readonly overlay?: ReactNode;
	readonly children: ReactNode;
	readonly className?: string;
}

const ACTIVE_WINDOW_MS = 30_000;
const PROGRAMMATIC_SCROLL_MS = 450;

const isEditable = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName));

const prefersReducedMotion = () =>
	globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * The Focus take-over's reader: the reading theme over the whole window, the
 * content in one 680px column, and every block but the focused one faded by
 * its distance (text opacity only — no overlay or gradient). Focus follows
 * the reader by scrolling (the block at the column's middle), the pointer, or
 * ↑ ↓ only (↑ ↓ work in every mode and recentre the column). Content may
 * change while open (a streaming reply): blocks are re-read after each change
 * and focus stays on the same block. Esc exits unless a popup is open inside.
 * Only the column takes the reading text size; the reader's own chrome (Exit,
 * hint) keeps the app's. Popups (the Aa menu, the selection menu) portal into
 * a layer beside the themed root, so they keep the app's theme and size.
 */
export function FocusReader({
	theme,
	scheme,
	typography,
	dimming,
	movesWith,
	initialBlock,
	onExit,
	onFocusChange,
	onCopy,
	onVisitEnd,
	control,
	toastSlot,
	overlay,
	children,
	className,
}: FocusReaderProps) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const [popupLayer, setPopupLayer] = useState<HTMLDivElement | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [blocks, setBlocks] = useState<readonly ReadingBlock[]>([]);
	const [focused, setFocused] = useState(-1);
	// Mirrors of state for listeners, written where the state is set.
	const focusedIndex = useRef(-1);
	const focusedElement = useRef<HTMLElement | null>(null);
	const layers = useRef(0);
	const programmaticUntil = useRef(0);
	const stats = useRef({
		startedAt: 0,
		lastInteraction: 0,
		activeSeconds: 0,
		visited: new Set<number>(),
		maxIndex: 0,
		keys: 0,
		scroll: 0,
		pointer: 0,
		copies: 0,
		typing: 0,
		find: 0,
	});
	const blocksRef = useRef<readonly ReadingBlock[]>([]);
	const latest = useLatestRef({ onExit, onFocusChange, onCopy, onVisitEnd, initialBlock });

	const context: FocusReaderContextValue = {
		portalContainer: popupLayer,
		openLayer: () => {
			layers.current += 1;
			let closed = false;
			return () => {
				if (closed) return;
				closed = true;
				layers.current -= 1;
			};
		},
	};

	const focusBlock = useStableCallback((index: number, source: FocusMoveSource | null) => {
		const list = blocksRef.current;
		if (index < 0 || index >= list.length) return;
		const record = stats.current;
		if (focusedIndex.current === index && focusedElement.current === list[index]!.elements[0])
			return;
		if (source) record[source] += 1;
		focusedIndex.current = index;
		setFocused(index);
		focusedElement.current = list[index]!.elements[0]!;
		record.visited.add(index);
		record.maxIndex = Math.max(record.maxIndex, index);
		latest.current.onFocusChange?.(index, list[index]);
	});

	const centre = useStableCallback((index: number, smooth: boolean) => {
		const area = scroller.current;
		const block = blocksRef.current[index];
		if (!area || !block) return;
		const box = blockBox(block);
		const areaBox = area.getBoundingClientRect();
		const middle = areaBox.top + areaBox.height / 2;
		const delta = (box.top + box.bottom) / 2 - middle;
		programmaticUntil.current = Date.now() + PROGRAMMATIC_SCROLL_MS;
		area.scrollTo({
			top: area.scrollTop + delta,
			behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
		});
	});

	// Read blocks now and after every content change, keeping focus on the same block.
	useLayoutEffect(() => {
		const element = content.current;
		if (!element) return;
		let frame = 0;
		let first = true;
		const read = () => {
			frame = 0;
			const next = readingBlocks(element);
			blocksRef.current = next;
			setBlocks(next);
			if (first) {
				// Content may arrive after mount (a pane portals it in).
				if (next.length === 0) return;
				first = false;
				const { initialBlock: initial } = latest.current;
				const wanted = typeof initial === "function" ? initial(next) : initial;
				const start = wanted >= 0 && wanted < next.length ? wanted : 0;
				focusBlock(start, null);
				centre(start, false);
				return;
			}
			const kept = focusedElement.current ? blockIndexOf(next, focusedElement.current) : -1;
			if (kept >= 0) {
				focusedIndex.current = kept;
				setFocused(kept);
			} else if (next.length > 0)
				focusBlock(Math.min(Math.max(0, focusedIndex.current), next.length - 1), null);
		};
		read();
		const observer = new MutationObserver(() => {
			if (frame === 0) frame = requestAnimationFrame(read);
		});
		observer.observe(element, { childList: true, subtree: true, characterData: true });
		return () => {
			observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	}, [centre, focusBlock, latest]);

	// Dim by distance: text opacity on each block's elements.
	useLayoutEffect(() => {
		blocks.forEach((block, index) => {
			const opacity = focused < 0 ? 1 : blockOpacity(Math.abs(index - focused), dimming, scheme);
			for (const element of block.elements) {
				element.style.opacity = opacity === 1 ? "" : String(opacity);
				element.dataset.focusDistance = String(focused < 0 ? 0 : Math.abs(index - focused));
			}
		});
	}, [blocks, dimming, focused, scheme]);

	// Keys: Esc exits, ↑ ↓ move; also count typing and find attempts.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			stats.current.lastInteraction = Date.now();
			if (event.defaultPrevented) return;
			if (event.key === "Escape") {
				if (layers.current > 0) return;
				event.preventDefault();
				latest.current.onExit("escape");
				return;
			}
			if (isEditable(event.target)) return;
			const mod = event.metaKey || event.ctrlKey;
			if (mod && event.key.toLowerCase() === "f") {
				stats.current.find += 1;
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				// Shift+↑ ↓ extends a text selection, as anywhere else.
				if (mod || event.altKey || event.shiftKey) return;
				event.preventDefault();
				const current = Math.max(0, focusedIndex.current);
				const next = event.key === "ArrowDown" ? current + 1 : current - 1;
				if (next < 0 || next >= blocksRef.current.length) return;
				focusBlock(next, "keys");
				centre(next, true);
				return;
			}
			if (!mod && !event.altKey && event.key.length === 1) stats.current.typing += 1;
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [centre, focusBlock, latest]);

	// Scrolling mode: the block at the column's vertical middle takes focus.
	useEffect(() => {
		const area = scroller.current;
		if (!area || movesWith !== "scroll") return;
		let frame = 0;
		const onScroll = () => {
			stats.current.lastInteraction = Date.now();
			if (Date.now() < programmaticUntil.current || frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				const box = area.getBoundingClientRect();
				const index = blockIndexAt(blocksRef.current, box.top + box.height / 2);
				if (index >= 0) focusBlock(index, "scroll");
			});
		};
		area.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			area.removeEventListener("scroll", onScroll);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [focusBlock, movesWith]);

	// Pointer mode: the block under the pointer takes focus.
	useEffect(() => {
		const element = content.current;
		if (!element || movesWith !== "pointer") return;
		const onMove = (event: PointerEvent) => {
			stats.current.lastInteraction = Date.now();
			if (event.buttons !== 0) return;
			const index = blockIndexOf(blocksRef.current, event.target as Node);
			if (index >= 0) focusBlock(index, "pointer");
		};
		element.addEventListener("pointermove", onMove);
		return () => element.removeEventListener("pointermove", onMove);
	}, [focusBlock, movesWith]);

	// Count active seconds; report the visit once on the way out.
	useEffect(() => {
		const record = stats.current;
		record.startedAt = Date.now();
		record.lastInteraction = record.startedAt;
		const timer = setInterval(() => {
			if (Date.now() - record.lastInteraction < ACTIVE_WINDOW_MS) record.activeSeconds += 1;
		}, 1000);
		return () => {
			clearInterval(timer);
			const count = blocksRef.current.length;
			latest.current.onVisitEnd?.({
				durationSeconds: Math.round((Date.now() - record.startedAt) / 1000),
				activeSeconds: record.activeSeconds,
				blockCount: count,
				blocksVisited: record.visited.size,
				maxBlockPct: count === 0 ? 0 : Math.round(((record.maxIndex + 1) / count) * 100),
				movesByKeys: record.keys,
				movesByScroll: record.scroll,
				movesByPointer: record.pointer,
				copies: record.copies,
				typingAttempts: record.typing,
				findAttempts: record.find,
			});
		};
	}, [latest]);

	// Take keyboard focus so ↑ ↓ and Esc reach the reader, and hand it back to
	// whatever held it before Focus opened once the reader goes away (the frame
	// under it is inert while open, so its own focus is gone on exit).
	useEffect(() => {
		const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		root?.focus({ preventScroll: true });
		return () => {
			if (restore?.isConnected) restore.focus({ preventScroll: true });
		};
	}, [root]);

	const style = {
		...theme.style,
		backgroundColor: "var(--background)",
		color: "var(--foreground)",
	} as CSSProperties;
	const columnStyle = {
		maxWidth: FOCUS_COLUMN_WIDTH + 48,
		"--focus-font-size": `${typography.fontSize}px`,
		"--focus-heading-size": `${typography.headingSize}px`,
		"--focus-line-height": String(typography.lineHeight),
		"--focus-block-gap": `${typography.blockGap}px`,
		...typography.cssVars,
	} as CSSProperties;

	return (
		<FocusReaderContext value={context}>
			<div
				ref={setRoot}
				tabIndex={-1}
				{...theme.attributes}
				style={style}
				data-qa-id="focus-reader"
				data-moves-with={movesWith}
				className={cn("focus-reader relative flex size-full flex-col outline-none", className)}
				onCopy={() => {
					stats.current.copies += 1;
					const text = globalThis.getSelection?.()?.toString() ?? "";
					if (text) latest.current.onCopy?.(text);
				}}
			>
				<div
					ref={scroller}
					className="min-h-0 flex-1 overflow-y-auto"
					data-qa-id="focus-reader-scroller"
				>
					<div
						ref={content}
						className="focus-reader-column mx-auto px-6 py-[45vh]"
						style={columnStyle}
						data-qa-id="focus-reader-content"
					>
						{children}
					</div>
				</div>
				{overlay}
				<button
					type="button"
					onClick={() => latest.current.onExit("exit-button")}
					aria-label="Exit focus"
					aria-keyshortcuts="Escape"
					data-qa-id="focus-exit"
					className="text-muted-foreground hover:text-foreground bg-background/80 border-border-subtle focus-visible:ring-ring/50 absolute top-5 right-[calc(24px+var(--window-controls-width,0px))] z-10 inline-flex h-[30px] items-center gap-2 rounded-full border px-3 text-xs backdrop-blur outline-none [-webkit-app-region:no-drag] focus-visible:ring-3"
				>
					Exit focus
					<kbd aria-hidden="true" className="text-muted-foreground/80 font-sans text-[11px]">
						Esc
					</kbd>
				</button>
				<div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center [&>*]:pointer-events-auto">
					<div ref={toastSlot} className="peer contents" data-qa-id="focus-toast-slot" />
					<p
						className="text-muted-foreground/80 text-xs peer-[:not(:empty)]:hidden"
						data-qa-id="focus-hint"
					>
						↑ ↓ to move between paragraphs
					</p>
				</div>
				{control ? <div className="absolute right-6 bottom-6 z-10">{control}</div> : null}
			</div>
			<div ref={setPopupLayer} className="contents" data-qa-id="focus-reader-popups" />
		</FocusReaderContext>
	);
}
