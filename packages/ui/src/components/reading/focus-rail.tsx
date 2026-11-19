import { useEffect, useRef, useState } from "react";
import { ScanLineIcon } from "lucide-react";

import { Kbd } from "@kilo-desktop/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import {
	blockBox,
	blockIndexOf,
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
	 * rail sits at its right edge, level with the hovered block.
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
	readonly target: FocusRailTarget;
	readonly top: number;
	readonly height: number;
	readonly markerLeft: number;
	readonly railLeft: number;
	/** Where the bridge to a rail outside the host starts; null when the rail is inside. */
	readonly bridgeLeft: number | null;
}

/** How far the bridge reaches back over the host's edge, so rounding leaves no gap. */
const BRIDGE_OVERLAP = 2;

/** The rail and its bridge: the pointer over either keeps the rail where it is. */
const RAIL_PART = "[data-focus-rail-part]";

/**
 * "Focus from here": while the pointer is over a block of reading text, a
 * 28px pill with one 22px button appears at the host's right edge, level
 * with the block, and a 2px marker at the block's left edge shows which
 * block it means. It stays on the last block while the pointer crosses to
 * it, hides while the pointer is down or text is selected, and on leaving.
 * Placed outside the host, the rail is reached across the host's edge, which
 * would fire `pointerleave`; an invisible bridge (a descendant of the host)
 * spans that gap over the block's height, so the pointer never leaves.
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
	const latest = useRef({ onFocusFrom, surfaceSelector, side });
	latest.current = { onFocusFrom, surfaceSelector, side };

	useEffect(() => {
		if (!host) return;
		let pressed = false;
		const place = (node: Node | null) => {
			const element = node instanceof Element ? node : node?.parentElement;
			const surface = element?.closest<HTMLElement>(latest.current.surfaceSelector);
			if (!surface || !host.contains(surface)) return false;
			const blocks = readingBlocks(surface);
			const index = blockIndexOf(blocks, element ?? null);
			const block = blocks[index];
			if (!block) return false;
			const hostBox = host.getBoundingClientRect();
			const box = blockBox(block);
			const left = Math.min(...block.elements.map((each) => each.getBoundingClientRect().left));
			const parentRight = host.parentElement?.getBoundingClientRect().right ?? hostBox.right;
			const outside =
				latest.current.side === "outside" && parentRight - hostBox.right >= RAIL_WIDTH + 8;
			setPlacement({
				target: { surface, block, index },
				top: box.top - hostBox.top + host.scrollTop,
				height: box.bottom - box.top,
				markerLeft: left - hostBox.left - 8,
				railLeft: outside ? hostBox.width + 4 : hostBox.width - RAIL_WIDTH - 8,
				bridgeLeft: outside ? hostBox.width - BRIDGE_OVERLAP : null,
			});
			return true;
		};
		const selecting = () => {
			const selection = globalThis.getSelection?.();
			return Boolean(selection && !selection.isCollapsed);
		};
		const onMove = (event: PointerEvent) => {
			if (pressed || event.buttons !== 0 || selecting()) {
				setPlacement(null);
				return;
			}
			const target = event.target as Element | null;
			if (target?.closest(RAIL_PART)) return;
			place(target);
		};
		const onDown = (event: PointerEvent) => {
			if ((event.target as Element | null)?.closest(RAIL_PART)) return;
			pressed = true;
			setPlacement(null);
		};
		const onUp = () => {
			pressed = false;
		};
		const onLeave = () => setPlacement(null);
		const onScroll = () => setPlacement(null);
		host.addEventListener("pointermove", onMove);
		host.addEventListener("pointerdown", onDown);
		window.addEventListener("pointerup", onUp);
		host.addEventListener("pointerleave", onLeave);
		host.addEventListener("scroll", onScroll, { capture: true, passive: true });
		return () => {
			host.removeEventListener("pointermove", onMove);
			host.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointerup", onUp);
			host.removeEventListener("pointerleave", onLeave);
			host.removeEventListener("scroll", onScroll, { capture: true });
		};
	}, [host]);

	if (!placement) return null;
	const railTop = placement.top + Math.min(placement.height, 28) / 2 - 14;
	const bridgeTop = Math.min(placement.top, railTop);
	const bridgeBottom = Math.max(placement.top + placement.height, railTop + RAIL_WIDTH);
	return (
		<>
			<span
				aria-hidden="true"
				data-qa-id={`${qaId}-marker`}
				className="bg-foreground/40 pointer-events-none absolute z-10 w-0.5 rounded-full"
				style={{ top: placement.top, height: placement.height, left: placement.markerLeft }}
			/>
			{placement.bridgeLeft === null ? null : (
				<span
					aria-hidden="true"
					data-focus-rail-part=""
					data-qa-id={`${qaId}-bridge`}
					className="absolute z-10"
					style={{
						top: bridgeTop,
						height: bridgeBottom - bridgeTop,
						left: placement.bridgeLeft,
						width: placement.railLeft + RAIL_WIDTH - placement.bridgeLeft,
					}}
				/>
			)}
			<div
				data-focus-rail-part=""
				data-qa-id={qaId}
				className="bg-popover border-border-subtle absolute z-10 flex w-7 justify-center rounded-full border py-[2px] shadow-sm"
				style={{ top: railTop, left: placement.railLeft }}
			>
				{/* The tooltip slides in over the button; taking the pointer, it would read as leaving the host. */}
				<Tooltip disableHoverablePopup>
					<TooltipTrigger
						render={
							<button
								type="button"
								aria-label="Focus from here"
								data-qa-id={`${qaId}-button`}
								onClick={() => latest.current.onFocusFrom(placement.target)}
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
