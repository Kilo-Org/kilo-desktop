import { ChevronDownIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@kilo-desktop/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";

import type { GitBranch } from "../contracts/schemas.js";
import { branchDisplayName } from "./branch-display-name.js";
import { groupBranches } from "./group-branches.js";

const CREATE_BRANCH_VALUE = "__create-branch__";

export interface BranchPickerPopoverProps {
	/** Inline-start icon element (sized via `data-icon`), e.g. branch or fork. */
	readonly triggerIcon: ReactNode;
	readonly triggerLabel: string;
	readonly triggerTestId: string;
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
	return (
		<CommandItem
			data-qa-id={`${itemTestIdPrefix}${label}`}
			value={label}
			data-checked={checked}
			disabled={disabled}
			onSelect={() => onSelect(branch)}
		>
			<GitBranchIcon className="text-muted-foreground" />
			<span className="min-w-0 truncate">{label}</span>
		</CommandItem>
	);
}

/**
 * Shared presentational branch popover for the composer draft footer:
 * trigger, grouped command list with search, and the optional pinned
 * create item. Owns only presentation and the open/search state (cleared
 * on open, on close, and on every programmatic close — branch select,
 * create, Escape). Callers own everything else: the data (branch list,
 * grouping inputs, checked branch), the side effects behind `onSelect`
 * (checkout or pure state write), the note copy for probe states, and
 * the create flow behind `onCreateBranch`. Checked state compares full
 * contract names while items display `branchDisplayName` labels — a
 * local and remote branch can share a display label by design.
 */
export function BranchPickerPopover({
	triggerIcon,
	triggerLabel,
	triggerTestId,
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

	const trimmedSearch = search.trim();

	// Programmatic closes (branch select, create, Escape) set `open`
	// directly and never reach `onOpenChange`, so they reset the search
	// here to keep a stale value from leaking into the next open.
	const closePopover = () => {
		setSearch("");
		setOpen(false);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				// Clear on open and close alike — clearing an
				// already-empty search on open is a no-op.
				setSearch("");
				setOpen(nextOpen);
			}}
		>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="max-w-56"
						data-qa-id={triggerTestId}
					/>
				}
			>
				{triggerIcon}
				<span className="truncate">{triggerLabel}</span>
				<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="bottom"
				sideOffset={6}
				collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
				className="w-72 gap-0 p-0"
				onKeyDown={(event) => {
					if (event.key === "Escape") closePopover();
				}}
			>
				{note !== null && note !== undefined ? (
					<div data-qa-id={noteTestId} className="text-muted-foreground px-3 py-2.5 text-sm">
						{note}
					</div>
				) : (
					<Command label="Search branches">
						<CommandInput placeholder="Search branches" value={search} onValueChange={setSearch} />
						<CommandList className="scroll-fade max-h-[calc(1.75rem*5)]">
							<CommandEmpty>
								{branches.length === 0 ? "No branches yet." : "No branches found."}
							</CommandEmpty>
							{groupBranches(branches, defaultBranch, recentBranches).map((group) => (
								<CommandGroup key={group.identifier} heading={group.heading}>
									{group.items.map((branch) => (
										<BranchItem
											key={branch.ref}
											branch={branch}
											checked={branch.name === checkedBranch}
											disabled={itemsDisabled ?? false}
											itemTestIdPrefix={itemTestIdPrefix}
											onSelect={(selected) => {
												onSelect(selected);
												closePopover();
											}}
										/>
									))}
								</CommandGroup>
							))}
						</CommandList>
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
