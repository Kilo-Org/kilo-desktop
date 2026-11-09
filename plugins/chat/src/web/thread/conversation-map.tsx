import {
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
	type ComponentProps,
	type FocusEvent,
	type KeyboardEvent,
	type PointerEvent,
} from "react";

import { Tooltip, TooltipContent } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { clamp } from "../usage/range";

export interface ConversationMapEntry {
	id: string;
	title: string;
	preview?: string;
}

const TICK = '[data-slot="conversation-map-tick"]';
/** Hover delay before the first preview; moving between ticks then swaps it at once. */
const PREVIEW_DELAY_MS = 120;

type Preview = { index: number; anchor: HTMLElement };

const tickIndex = (target: EventTarget | null): Preview | null => {
	const tick = target instanceof Element ? target.closest<HTMLElement>(TICK) : null;
	const index = Number(tick?.dataset["index"]);
	return tick && Number.isInteger(index) ? { index, anchor: tick } : null;
};

/** A rail of ticks, one per turn, that previews a turn on hover and jumps to it on click. */
export function ConversationMap({
	entries,
	activeId,
	visibleIds,
	onSelect,
	side = "right",
	className,
	onKeyDown,
	...props
}: Omit<ComponentProps<"nav">, "children" | "onSelect"> & {
	entries: readonly ConversationMapEntry[];
	activeId?: string | undefined;
	visibleIds?: readonly string[] | undefined;
	onSelect?: ((id: string) => void) | undefined;
	side?: "left" | "right";
}) {
	const railRef = useRef<HTMLElement>(null);
	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
	const preview = useTickPreview();

	const inView = new Set(visibleIds);
	const activeIndex = entries.findIndex((entry) => entry.id === activeId);
	const tabbableIndex = clamp(
		focusedIndex ?? Math.max(0, activeIndex),
		0,
		Math.max(0, entries.length - 1),
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLElement>) => {
			onKeyDown?.(event);
			if (event.defaultPrevented) return;

			const ticks = railRef.current?.querySelectorAll<HTMLElement>(TICK);
			if (!ticks?.length) return;

			const current = Array.prototype.indexOf.call(ticks, event.target);
			if (current === -1) return;

			const next = {
				ArrowUp: current - 1,
				ArrowDown: current + 1,
				Home: 0,
				End: ticks.length - 1,
			}[event.key];
			if (next === undefined) return;

			event.preventDefault();
			ticks[clamp(next, 0, ticks.length - 1)]?.focus();
		},
		[onKeyDown],
	);

	const previewEntry = preview.current ? entries[preview.current.index] : undefined;

	return (
		<>
			<nav
				data-slot="conversation-map"
				ref={railRef}
				aria-label="Conversation map"
				onKeyDown={handleKeyDown}
				onPointerOver={preview.onPointerOver}
				onPointerLeave={preview.hide}
				onFocus={preview.onFocus}
				onBlur={preview.hide}
				className={cn("group/rail flex h-full w-6 flex-col justify-center", className)}
				{...props}
			>
				{entries.map((entry, index) => {
					const current = index === activeIndex;
					return (
						<ConversationMapTick
							key={entry.id}
							entry={entry}
							index={index}
							current={current}
							onScreen={current || inView.has(entry.id)}
							tabbable={index === tabbableIndex}
							onFocusIndex={setFocusedIndex}
							onSelect={onSelect}
						/>
					);
				})}
			</nav>
			<Tooltip open={previewEntry !== undefined}>
				{previewEntry ? (
					<TooltipContent
						anchor={preview.current?.anchor}
						side={side}
						sideOffset={10}
						arrowClassName="hidden"
						className="bg-popover text-popover-foreground border-border-subtle ring-foreground/10 pointer-events-none flex w-60 max-w-60 flex-col items-start gap-0 rounded-xl p-3.5 text-left shadow-md ring-1"
					>
						<p className="line-clamp-2 text-sm leading-snug font-medium">{previewEntry.title}</p>
						{previewEntry.preview ? (
							<p className="text-muted-foreground line-clamp-3 text-sm leading-snug">
								{previewEntry.preview}
							</p>
						) : null}
					</TooltipContent>
				) : null}
			</Tooltip>
		</>
	);
}

/**
 * The rail's single turn preview. A tooltip per tick made mounting a long
 * chat's rail costly (each trigger carries its own floating-UI state), so the
 * rail tracks the hovered or focused tick itself and anchors one tooltip to
 * it. Ticks keep their accessible name (`aria-label`); the preview only adds
 * the visual excerpt.
 */
function useTickPreview() {
	const [current, setCurrent] = useState<Preview | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const isOpen = useRef(false);
	isOpen.current = current !== null;

	const clearTimer = () => {
		if (timer.current !== undefined) clearTimeout(timer.current);
		timer.current = undefined;
	};
	useEffect(() => clearTimer, []);

	const show = (next: Preview, immediate: boolean) => {
		clearTimer();
		if (immediate || isOpen.current) {
			setCurrent((previous) =>
				previous?.index === next.index && previous.anchor === next.anchor ? previous : next,
			);
			return;
		}
		timer.current = setTimeout(() => setCurrent(next), PREVIEW_DELAY_MS);
	};

	return {
		current,
		onPointerOver: (event: PointerEvent<HTMLElement>) => {
			const next = tickIndex(event.target);
			if (next) show(next, false);
		},
		onFocus: (event: FocusEvent<HTMLElement>) => {
			const next = tickIndex(event.target);
			if (next && event.target.matches(":focus-visible")) show(next, true);
		},
		hide: () => {
			clearTimer();
			setCurrent(null);
		},
	};
}

/**
 * One tick per turn; memoized because a long thread has hundreds and the rail
 * re-renders whenever the reading position moves.
 */
const ConversationMapTick = memo(function ConversationMapTick({
	entry,
	index,
	current,
	onScreen,
	tabbable,
	onFocusIndex,
	onSelect,
}: {
	entry: ConversationMapEntry;
	index: number;
	current: boolean;
	onScreen: boolean;
	tabbable: boolean;
	onFocusIndex: (index: number) => void;
	onSelect?: ((id: string) => void) | undefined;
}) {
	return (
		<button
			type="button"
			data-slot="conversation-map-tick"
			data-index={index}
			data-active={current ? "" : undefined}
			data-in-view={onScreen ? "" : undefined}
			aria-label={entry.title}
			aria-current={current ? "true" : undefined}
			tabIndex={tabbable ? 0 : -1}
			onFocus={() => onFocusIndex(index)}
			onClick={(event) => {
				onSelect?.(entry.id);
				event.currentTarget.blur();
			}}
			className="group flex max-h-2.5 min-h-0 flex-1 items-center outline-none"
		>
			<span
				className={cn(
					"w-[7px] rounded-full transition-[width,height,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
					current
						? "bg-foreground/90 h-[3px] group-focus-within/rail:w-5 group-hover/rail:w-5"
						: cn(
								"group-hover:bg-foreground/70 group-focus-visible:bg-foreground/70 h-0.5",
								"group-hover:w-6! group-focus-visible:w-6!",
								onScreen
									? "bg-foreground/50 group-focus-within/rail:w-4 group-hover/rail:w-4"
									: "bg-foreground/15",
							),
				)}
			/>
		</button>
	);
});
