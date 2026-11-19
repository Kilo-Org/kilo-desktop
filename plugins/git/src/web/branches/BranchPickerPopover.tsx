import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDownIcon, CloudIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import {
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
} from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@kilo-desktop/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { pickerMenuWidth } from "@kilo-desktop/ui/lib/menu-styles";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { GitBranch } from "../../contracts";
import { branchDisplayName, branchSearchValue, splitRemoteBranch } from "./branch-display-name";
import { filterBranchGroups, groupBranches } from "./group-branches";

const CREATE_BRANCH_VALUE = "__create-branch__";
/** Row height of a branch item and a group heading; measureElement corrects drift. */
const ROW_ESTIMATE_PX = 28;
const LIST_OVERSCAN = 10;

type BranchRow =
	| { readonly kind: "heading"; readonly key: string; readonly heading: string }
	| {
			readonly kind: "branch";
			readonly key: string;
			readonly branch: GitBranch;
			readonly value: string;
	  };

type ListMove = "next" | "previous" | "first" | "last";

export interface BranchPickerPopoverProps {
	/** Inline-start icon element (sized via `data-icon`), e.g. branch or fork. */
	readonly triggerIcon: ReactNode;
	readonly triggerLabel: string;
	/**
	 * When true, the trigger swaps its icon for a spinner and mutes the
	 * label (the app's loading convention) while staying clickable and
	 * setting `aria-busy` — the popover still opens and explains the
	 * state, so the button's availability never changes.
	 */
	readonly triggerLoading?: boolean | undefined;
	readonly triggerTestId: string;
	readonly triggerDisabled?: boolean | undefined;
	readonly branches: ReadonlyArray<GitBranch>;
	/** Contract name of the default branch, used for the group bucket. */
	readonly defaultBranch: string | undefined;
	readonly recentBranches: ReadonlyArray<string>;
	/** Contract name of the branch to show checked (`branch.name` comparison). */
	readonly checkedBranch: string | undefined;
	readonly itemsDisabled?: boolean | undefined;
	/** Prepended to each item's display label to form its `data-qa-id`. */
	readonly itemTestIdPrefix: string;
	/**
	 * When set, replaces the command list with an inline note — the local
	 * selector's checking / not-a-repository / error states. Accepts a
	 * string for simple messages or a ReactNode for structured content
	 * (e.g. the unborn-HEAD warning with heading and body paragraphs).
	 */
	readonly note?: ReactNode;
	readonly noteTestId?: string | undefined;
	/** Invoked with the picked branch; the popover closes right after. */
	readonly onSelect: (branch: GitBranch) => void;
	/**
	 * When provided, the popover pins a "Create branch" item that calls
	 * back with the trimmed search text before closing (local mode seeds
	 * its dialog's name field from it).
	 */
	readonly onCreateBranch?: ((searchText: string) => void) | undefined;
}

function BranchItem({
	branch,
	checked,
	disabled,
	itemTestIdPrefix,
	onSelect,
}: {
	branch: GitBranch;
	checked: boolean;
	disabled: boolean;
	itemTestIdPrefix: string;
	onSelect: (branch: GitBranch) => void;
}) {
	const label = branchDisplayName(branch);
	const remote = branch.kind === "remote";
	return (
		<CommandItem
			data-qa-id={`${itemTestIdPrefix}${label}`}
			value={branchSearchValue(branch)}
			data-checked={checked}
			disabled={disabled}
			onSelect={() => onSelect(branch)}
		>
			{remote ? (
				<CloudIcon className="text-muted-foreground" />
			) : (
				<GitBranchIcon className="text-muted-foreground" />
			)}
			<span className="min-w-0 truncate">
				{remote ? (
					<span className="text-muted-foreground">{splitRemoteBranch(branch).remote}/</span>
				) : null}
				{label}
			</span>
		</CommandItem>
	);
}

function toRows(groups: ReturnType<typeof filterBranchGroups>): ReadonlyArray<BranchRow> {
	return groups.flatMap((group): BranchRow[] => [
		{ kind: "heading", key: `heading:${group.identifier}`, heading: group.heading },
		...group.items.map((branch): BranchRow => ({
			kind: "branch",
			key: branch.ref,
			branch,
			value: branchSearchValue(branch),
		})),
	]);
}

/** The keys cmdk moves its highlight with (its vim bindings included). */
function listMoveFor(event: KeyboardEvent): ListMove | undefined {
	const vim = event.ctrlKey && !event.metaKey && !event.altKey;
	switch (event.key) {
		case "ArrowDown":
			return event.metaKey ? "last" : "next";
		case "ArrowUp":
			return event.metaKey ? "first" : "previous";
		case "Home":
			return "first";
		case "End":
			return "last";
		case "n":
		case "j":
			return vim ? "next" : undefined;
		case "p":
		case "k":
			return vim ? "previous" : undefined;
		default:
			return undefined;
	}
}

function movedPosition(move: ListMove, current: number, count: number): number {
	switch (move) {
		case "first":
			return 0;
		case "last":
			return count - 1;
		case "next":
			return Math.min(current + 1, count - 1);
		case "previous":
			return Math.max(current - 1, 0);
	}
}

/**
 * The scrollable branch rows, rendered only while in view so a repository with
 * thousands of remote branches opens instantly. cmdk sees only these mounted
 * items, which is why the picker filters and moves the keyboard highlight itself.
 */
function BranchList({
	rows,
	checkedBranch,
	disabled,
	itemTestIdPrefix,
	onSelect,
	scrollToRowRef,
}: {
	rows: ReadonlyArray<BranchRow>;
	checkedBranch: string | undefined;
	disabled: boolean;
	itemTestIdPrefix: string;
	onSelect: (branch: GitBranch) => void;
	scrollToRowRef: RefObject<(index: number) => void>;
}) {
	"use no memo";
	// TanStack's useVirtualizer mutates one instance in place, so memoizing its readers would show stale rows.
	const listRef = useRef<HTMLDivElement>(null);
	// This component opts out of React Compiler with "use no memo" above.
	// react-doctor-disable-next-line react-hooks-js/incompatible-library
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => listRef.current,
		estimateSize: () => ROW_ESTIMATE_PX,
		overscan: LIST_OVERSCAN,
		getItemKey: (index) => rows[index]?.key ?? index,
	});

	// Only keyboard handlers call this, after commit, so the committed rows are the ones to scroll.
	useLayoutEffect(() => {
		scrollToRowRef.current = (index) => virtualizer.scrollToIndex(index, { align: "auto" });
	});

	return (
		<CommandList ref={listRef} className="scroll-fade">
			<div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
				{virtualizer.getVirtualItems().map((virtualRow) => {
					const row = rows[virtualRow.index];
					if (row === undefined) return null;
					return (
						<div
							key={row.key}
							data-index={virtualRow.index}
							ref={virtualizer.measureElement}
							className="absolute top-0 left-0 w-full"
							style={{ transform: `translateY(${virtualRow.start}px)` }}
						>
							{row.kind === "heading" ? (
								// Same inset and type as CommandGroup headings.
								<div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
									{row.heading}
								</div>
							) : (
								<BranchItem
									branch={row.branch}
									checked={row.branch.name === checkedBranch}
									disabled={disabled}
									itemTestIdPrefix={itemTestIdPrefix}
									onSelect={onSelect}
								/>
							)}
						</div>
					);
				})}
			</div>
		</CommandList>
	);
}

/**
 * Presentational branch popover for the New Session page's branch picker:
 * trigger, grouped command list with search, and the optional pinned
 * create item. Owns only presentation and the open/search state (cleared
 * on open, on close, and on every programmatic close — branch select,
 * create, Escape). Callers own everything else: the data (branch list,
 * grouping inputs, checked branch), the side effects behind `onSelect`
 * (checkout or pure state write), the note copy for probe states, the
 * `triggerLoading` flag for the trigger's loading look, and the create
 * flow behind `onCreateBranch`. Checked state compares full contract
 * names; remote items show their remote as a muted prefix.
 */
export function BranchPickerPopover({
	triggerIcon,
	triggerLabel,
	triggerLoading,
	triggerTestId,
	triggerDisabled,
	branches,
	defaultBranch,
	recentBranches,
	checkedBranch,
	itemsDisabled,
	itemTestIdPrefix,
	note,
	noteTestId,
	onSelect,
	onCreateBranch,
}: BranchPickerPopoverProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [highlighted, setHighlighted] = useState("");
	const scrollToRowRef = useRef<(index: number) => void>(() => {});

	const trimmedSearch = search.trim();
	const rowsFor = (query: string) =>
		toRows(filterBranchGroups(groupBranches(branches, defaultBranch, recentBranches), query));
	const rows = rowsFor(search);

	// Highlights the first match itself instead of relying on cmdk, whose
	// controlled value would otherwise still name a row the search removed.
	const changeSearch = (next: string) => {
		setSearch(next);
		const firstMatch = rowsFor(next).find((row) => row.kind === "branch");
		setHighlighted(firstMatch?.kind === "branch" ? firstMatch.value : "");
	};

	const moveHighlight = (event: KeyboardEvent) => {
		const move = listMoveFor(event);
		if (move === undefined || itemsDisabled) return;
		const branchRowIndexes = rows.flatMap((row, index) => (row.kind === "branch" ? [index] : []));
		if (branchRowIndexes.length === 0) return;
		// Handled here instead of by cmdk, which can only step through mounted rows.
		event.preventDefault();
		const current = branchRowIndexes.findIndex((index) => {
			const row = rows[index];
			return row?.kind === "branch" && row.value === highlighted;
		});
		const rowIndex = branchRowIndexes[movedPosition(move, current, branchRowIndexes.length)];
		const row = rowIndex === undefined ? undefined : rows[rowIndex];
		if (rowIndex === undefined || row?.kind !== "branch") return;
		setHighlighted(row.value);
		const headingAbove = rows[rowIndex - 1]?.kind === "heading";
		const movingUp = move === "previous" || move === "first";
		scrollToRowRef.current(headingAbove && movingUp ? rowIndex - 1 : rowIndex);
	};

	// Programmatic closes (branch select, create, Escape) set `open`
	// directly and never reach `onOpenChange`, so they reset the search
	// here to keep a stale value from leaking into the next open.
	const closePopover = () => {
		setSearch("");
		setHighlighted("");
		setOpen(false);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				// Clear on open and close alike — clearing an
				// already-empty search on open is a no-op.
				setSearch("");
				setHighlighted("");
				setOpen(nextOpen);
			}}
		>
			<PopoverTrigger
				disabled={triggerDisabled}
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="max-w-56"
						data-qa-id={triggerTestId}
						aria-busy={triggerLoading ?? false}
					/>
				}
			>
				{triggerLoading ? (
					// Pinned to the `sm` Button's icon size so swapping icons doesn't shift the label.
					<Spinner data-icon="inline-start" className="size-3.5" aria-hidden="true" />
				) : (
					triggerIcon
				)}
				<span className={cn("truncate", triggerLoading && "text-muted-foreground")}>
					{triggerLabel}
				</span>
				<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="bottom"
				collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
				className={cn(pickerMenuWidth, "gap-0 p-0")}
				onKeyDown={(event) => {
					if (event.key === "Escape") closePopover();
				}}
			>
				{note !== null && note !== undefined ? (
					<div data-qa-id={noteTestId} className="text-muted-foreground px-3 py-2.5 text-sm">
						{note}
					</div>
				) : (
					<Command
						label="Search branches"
						shouldFilter={false}
						value={highlighted}
						onValueChange={setHighlighted}
						onKeyDown={moveHighlight}
					>
						<CommandInput
							placeholder="Search branches"
							value={search}
							onValueChange={changeSearch}
						/>
						{rows.length === 0 ? (
							<div data-slot="command-empty" className="py-6 text-center text-sm">
								{branches.length === 0 ? "No branches yet." : "No branches found."}
							</div>
						) : (
							// Remounting per search puts the scroll back at the top, where the
							// highlighted first match is.
							<BranchList
								key={trimmedSearch}
								rows={rows}
								checkedBranch={checkedBranch}
								disabled={itemsDisabled ?? false}
								itemTestIdPrefix={itemTestIdPrefix}
								onSelect={(selected) => {
									onSelect(selected);
									closePopover();
								}}
								scrollToRowRef={scrollToRowRef}
							/>
						)}
						{/* Pinned create item (the workspace picker's "Create workspace"
						    pattern): a force-mount sibling of the scrollable list, so it
						    stays visible regardless of filtering, never scrolls away, and
						    is click-only — cmdk's keyboard nav only covers list items. */}
						{onCreateBranch !== undefined ? (
							<>
								{/* Outside the list, so it must opt out of cmdk hiding it while filtering. */}
								<CommandSeparator alwaysRender />
								<CommandGroup forceMount>
									<CommandItem
										data-qa-id="git-branch-create"
										value={CREATE_BRANCH_VALUE}
										onSelect={() => {
											// Runs before `closePopover` clears the search —
											// the trimmed text seeds the dialog's name field.
											onCreateBranch(trimmedSearch);
											closePopover();
										}}
									>
										<PlusIcon />
										Create branch
									</CommandItem>
								</CommandGroup>
							</>
						) : null}
					</Command>
				)}
			</PopoverContent>
		</Popover>
	);
}
