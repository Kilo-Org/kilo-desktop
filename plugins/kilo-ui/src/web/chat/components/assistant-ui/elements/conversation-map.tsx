"use client";

import { useCallback, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { clamp } from "../utils/range.js";

export interface ConversationMapEntry {
	id: string;
	title: string;
	preview?: string;
}

const TICK = '[data-slot="conversation-map-tick"]';

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

	return (
		<TooltipProvider delay={120}>
			<nav
				data-slot="conversation-map"
				ref={railRef}
				aria-label="Conversation map"
				onKeyDown={handleKeyDown}
				className={cn("group/rail flex h-full w-6 flex-col justify-center", className)}
				{...props}
			>
				{entries.map((entry, index) => {
					const current = index === activeIndex;
					const onScreen = current || inView.has(entry.id);
					return (
						<Tooltip key={entry.id}>
							<TooltipTrigger
								render={<button type="button" />}
								data-slot="conversation-map-tick"
								data-active={current ? "" : undefined}
								data-in-view={onScreen ? "" : undefined}
								aria-label={entry.title}
								aria-current={current ? "true" : undefined}
								tabIndex={index === tabbableIndex ? 0 : -1}
								onFocus={() => setFocusedIndex(index)}
								onClick={(event) => {
									onSelect?.(entry.id);
									if (event.currentTarget instanceof HTMLElement) {
										event.currentTarget.blur();
									}
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
							</TooltipTrigger>
							<TooltipContent
								side={side}
								sideOffset={10}
								arrowClassName="hidden"
								className="bg-popover text-popover-foreground border-border-subtle ring-foreground/10 flex w-60 max-w-60 flex-col items-start gap-0 rounded-xl p-3.5 text-left shadow-md ring-1"
							>
								<p className="line-clamp-2 text-sm leading-snug font-medium">{entry.title}</p>
								{entry.preview ? (
									<p className="text-muted-foreground line-clamp-3 text-sm leading-snug">
										{entry.preview}
									</p>
								) : null}
							</TooltipContent>
						</Tooltip>
					);
				})}
			</nav>
		</TooltipProvider>
	);
}
