import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { BoardChip, BoardFilter } from "./board-insights";

/** Search and quick views appear once a board is this busy; smaller boards read top to bottom. */
export const SEARCH_FROM_POSTS = 20;

const CHIP_LABELS: Record<BoardChip, string> = {
	all: "All",
	"needs-you": "Needs you",
	blocking: "Blocking",
	mentions: "Mentions me",
};

/** The board's search box (⌘F focuses it) and quick views. */
export function BoardSearch({
	filter,
	onChange,
	counts,
	active,
}: {
	readonly filter: BoardFilter;
	readonly onChange: (next: BoardFilter) => void;
	readonly counts: Readonly<Partial<Record<BoardChip, number>>>;
	/** The pane is in front, so ⌘F is for it. */
	readonly active: boolean;
}) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!active) return;
		const focusSearch = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
				event.preventDefault();
				input.current?.focus();
			}
		};
		window.addEventListener("keydown", focusSearch);
		return () => window.removeEventListener("keydown", focusSearch);
	}, [active]);
	return (
		<div className="flex shrink-0 flex-col gap-2.5 px-5 pt-3.5" data-qa-id="swarm-board-search">
			<label className="bg-foreground/[0.04] ring-border focus-within:ring-ring flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] leading-4 ring-1 ring-inset focus-within:ring-2">
				<SearchIcon aria-hidden className="text-muted-foreground/70 size-3.5 shrink-0" />
				<input
					ref={input}
					type="search"
					className="placeholder:text-muted-foreground/70 min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden"
					placeholder="Search posts, agents, #refs"
					aria-label="Search the board"
					value={filter.query}
					onChange={(event) => onChange({ ...filter, query: event.target.value })}
					onKeyDown={(event) => {
						if (event.key === "Escape" && filter.query) {
							event.stopPropagation();
							onChange({ ...filter, query: "" });
						}
					}}
					data-qa-id="swarm-board-search-input"
				/>
				{filter.query ? (
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="Clear search"
						onClick={() => onChange({ ...filter, query: "" })}
					>
						<XIcon />
					</Button>
				) : (
					<kbd className="text-muted-foreground/70 font-sans text-xs">⌘F</kbd>
				)}
			</label>
			<div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
				{(Object.keys(CHIP_LABELS) as BoardChip[]).map((chip) => {
					const selected = filter.chip === chip;
					const count = counts[chip];
					return (
						<button
							key={chip}
							type="button"
							role="radio"
							aria-checked={selected}
							className={cn(
								"rounded-full px-[9px] py-[3px] text-xs leading-4 transition-colors",
								selected
									? "bg-foreground text-background font-medium"
									: "bg-foreground/[0.07] text-foreground hover:bg-foreground/12",
							)}
							onClick={() => onChange({ ...filter, chip })}
							data-qa-id="swarm-board-chip"
							data-chip={chip}
						>
							{CHIP_LABELS[chip]}
							{count ? ` · ${count}` : ""}
						</button>
					);
				})}
			</div>
		</div>
	);
}
