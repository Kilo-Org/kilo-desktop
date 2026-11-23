import { useEffect, useState } from "react";
import { ScanLineIcon } from "lucide-react";

import { Kbd } from "@kilo-desktop/ui/components/kbd";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import {
	blockIndexAt,
	readingBlocks,
	type ReadingBlock,
} from "@kilo-desktop/ui/lib/reading/blocks";

export interface FocusRailTarget {
	/** The reading surface (`[data-reading-surface]`) holding the block. */
	readonly surface: HTMLElement;
	readonly block: ReadingBlock;
	/** The block's index among the surface's reading blocks. */
	readonly index: number;
}

export interface FocusRailProps {
	/**
	 * The positioned element the rail overlays (`position: relative`); the
	 * rail sits at its right edge, level with the middle of the text in view.
	 */
	readonly host: HTMLElement | null;
	readonly onFocusFrom: (target: FocusRailTarget) => void;
	/** Which surfaces offer the rail; reading surfaces by default. */
	readonly surfaceSelector?: string;
	/** The Focus shortcut as shown to the person, e.g. "⌘⇧F". */
	readonly shortcut?: string;
	/**
	 * "outside" sits the rail just beyond the host's right edge when its
	 * parent leaves room (a centred transcript column), else inside it.
	 */
	readonly placement?: "inside" | "outside";
	readonly qaId?: string;
}

const RAIL_WIDTH = 28;

interface Placement {
	/** The rail's top, in the host's coordinates. */
	readonly top: number;
	readonly railLeft: number;
	/** Where the bridge to a rail outside the host starts; null when the rail is inside. */
	readonly bridgeLeft: number | null;
}

/** How far the bridge reaches back over the host's edge, so rounding leaves no gap. */
const BRIDGE_OVERLAP = 2;

/** The rail and its bridge: the pointer over either keeps the rail where it is. */
const RAIL_PART = "[data-focus-rail-part]";

const CLIPS = new Set(["auto", "scroll", "hidden", "clip"]);

/** The part of the viewport an element can show in: the window cut by every clipping ancestor. */
function visibleArea(element: Element): { top: number; bottom: number } {
	let top = 0;
	let bottom = window.innerHeight;
	for (let node = element.parentElement; node; node = node.parentElement) {
		if (!CLIPS.has(getComputedStyle(node).overflowY)) continue;
		const box = node.getBoundingClientRect();
		top = Math.max(top, box.top);
		bottom = Math.min(bottom, box.bottom);
	}
	return { top, bottom };
}

/**
 * The middle of the reading text in view, in viewport coordinates: the
 * surfaces' extent cut by what the host can show. Null when none is in view.
 */
function textMiddle(host: HTMLElement, surfaces: readonly HTMLElement[]): number | null {
	if (surfaces.length === 0) return null;
	const boxes = surfaces.map((surface) => surface.getBoundingClientRect());
	const area = visibleArea(host);
	const top = Math.max(area.top, Math.min(...boxes.map((box) => box.top)));
	const bottom = Math.min(area.bottom, Math.max(...boxes.map((box) => box.bottom)));
	return bottom > top ? (top + bottom) / 2 : null;
}

/** The block at viewport height `y` among every surface's blocks, with its surface. */
function targetAt(surfaces: readonly HTMLElement[], y: number): FocusRailTarget | null {
	const entries = surfaces.flatMap((surface) =>
		readingBlocks(surface).map((block, index) => ({ surface, block, index })),
	);
	return (
		entries[
			blockIndexAt(
				entries.map(({ block }) => block),
				y,
			)
		] ?? null
	);
}

/**
 * "Focus from here": while the pointer is over reading text, a 28px pill with
 * one 22px button appears at the host's right edge, level with the middle of
 * the text in view, and stays there as the pointer moves (following the text
 * only as it scrolls). It enters Focus at the block in that middle, as ⌘⇧F
 * does. It hides while the pointer is down or text is selected, and on
 * leaving. Placed outside the host, the rail is reached across the host's
 * edge, which would fire `pointerleave`; an invisible bridge (a descendant
 * of the host) spans that gap at the rail's height, so the pointer never
 * leaves.
 */
export function FocusRail({
	host,
	onFocusFrom,
	surfaceSelector = "[data-reading-surface]",
	shortcut,
	placement: side = "inside",
	qaId = "focus-rail",
}: FocusRailProps) {
	const [placement, setPlacement] = useState<Placement | null>(null);
	const latest = useLatestRef({ onFocusFrom, surfaceSelector, side });

	useEffect(() => {
		if (!host) return;
		let pressed = false;
		let shown = false;
		let frame = 0;
		const surfaces = () => [...host.querySelectorAll<HTMLElement>(latest.current.surfaceSelector)];
		const hide = () => {
			shown = false;
			setPlacement(null);
		};
		const place = () => {
			const middle = textMiddle(host, surfaces());
			if (middle === null) return hide();
			const hostBox = host.getBoundingClientRect();
			const parentRight = host.parentElement?.getBoundingClientRect().right ?? hostBox.right;
			const outside =
				latest.current.side === "outside" && parentRight - hostBox.right >= RAIL_WIDTH + 8;
			shown = true;
			setPlacement({
				top: middle - hostBox.top + host.scrollTop - RAIL_WIDTH / 2,
				railLeft: outside ? hostBox.width + 4 : hostBox.width - RAIL_WIDTH - 8,
				bridgeLeft: outside ? hostBox.width - BRIDGE_OVERLAP : null,
			});
		};
		const selecting = () => {
			const selection = globalThis.getSelection?.();
			return Boolean(selection && !selection.isCollapsed);
		};
		const onMove = (event: PointerEvent) => {
			if (pressed || event.buttons !== 0 || selecting()) return hide();
			if (shown) return;
			const target = event.target as Element | null;
			const element = target instanceof Element ? target : null;
			const surface = element?.closest(latest.current.surfaceSelector);
			if (surface && host.contains(surface)) place();
		};
		const onDown = (event: PointerEvent) => {
			if ((event.target as Element | null)?.closest(RAIL_PART)) return;
			pressed = true;
			hide();
		};
		const onUp = () => {
			pressed = false;
		};
		// The rail keeps its place in the view: scrolling moves the text under it.
		const onScroll = () => {
			if (!shown || frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				if (shown) place();
			});
		};
		host.addEventListener("pointermove", onMove);
		host.addEventListener("pointerdown", onDown);
		window.addEventListener("pointerup", onUp);
		host.addEventListener("pointerleave", hide);
		window.addEventListener("scroll", onScroll, { capture: true, passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			host.removeEventListener("pointermove", onMove);
			host.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointerup", onUp);
			host.removeEventListener("pointerleave", hide);
			window.removeEventListener("scroll", onScroll, { capture: true });
			window.removeEventListener("resize", onScroll);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [host, latest]);

	const focusFromMiddle = () => {
		if (!host || !placement) return;
		const middle =
			host.getBoundingClientRect().top - host.scrollTop + placement.top + RAIL_WIDTH / 2;
		const surfaces = [...host.querySelectorAll<HTMLElement>(surfaceSelector)];
		const target = targetAt(surfaces, middle);
		if (target) onFocusFrom(target);
	};

	if (!placement) return null;
	return (
		<>
			{placement.bridgeLeft === null ? null : (
				<span
					aria-hidden="true"
					data-focus-rail-part=""
					data-qa-id={`${qaId}-bridge`}
					className="absolute z-10"
					style={{
						top: placement.top,
						height: RAIL_WIDTH,
						left: placement.bridgeLeft,
						width: placement.railLeft + RAIL_WIDTH - placement.bridgeLeft,
					}}
				/>
			)}
			<div
				data-focus-rail-part=""
				data-qa-id={qaId}
				className="bg-popover border-border-subtle absolute z-10 flex w-7 justify-center rounded-full border py-[2px] shadow-sm"
				style={{ top: placement.top, left: placement.railLeft }}
			>
				{/* The tooltip slides in over the button; taking the pointer, it would read as leaving the host. */}
				<Tooltip disableHoverablePopup>
					<TooltipTrigger
						render={
							<button
								type="button"
								aria-label="Focus from here"
								data-qa-id={`${qaId}-button`}
								onClick={focusFromMiddle}
								className="text-muted-foreground hover:text-foreground hover:bg-state-hover focus-visible:ring-ring/50 flex size-[22px] items-center justify-center rounded-full outline-none focus-visible:ring-2"
							/>
						}
					>
						<ScanLineIcon aria-hidden="true" className="size-3.5" />
					</TooltipTrigger>
					<TooltipContent side="left" className="pointer-events-none flex items-center gap-2">
						Focus from here
						{shortcut ? <Kbd>{shortcut}</Kbd> : null}
					</TooltipContent>
				</Tooltip>
			</div>
		</>
	);
}
