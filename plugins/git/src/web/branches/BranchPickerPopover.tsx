import { ChevronDownIcon, CloudIcon, GitBranchIcon, PlusIcon } from "lucide-react";
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
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { pickerMenuWidth } from "@kilo-desktop/ui/lib/menu-styles";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { GitBranch } from "../../contracts";
import { branchDisplayName, splitRemoteBranch } from "./branch-display-name";
import { groupBranches } from "./group-branches";

const CREATE_BRANCH_VALUE = "__create-branch__";

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
			value={remote ? branch.name : label}
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
					<Command label="Search branches">
						<CommandInput placeholder="Search branches" value={search} onValueChange={setSearch} />
						<CommandList className="scroll-fade">
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
