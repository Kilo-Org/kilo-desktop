import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kilo-desktop/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";

import { branchDisplayName, groupBranches, type IsolationBranch } from "./group-branches";

/**
 * Origin's base-branch picker for a new worktree: the grouped, searchable
 * branch popover. Picking a branch only records it as the worktree's base
 * (its full name, a valid `worktree add` commitish).
 */
export function BaseBranchPicker({
	selectedBase,
	defaultBase,
	branches,
	recentBranches,
	disabled,
	onSelect,
}: {
	readonly selectedBase: string | undefined;
	readonly defaultBase: string | null;
	readonly branches: readonly IsolationBranch[];
	readonly recentBranches: readonly string[];
	readonly disabled?: boolean | undefined;
	readonly onSelect: (baseBranch: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const effectiveBase = selectedBase ?? defaultBase ?? undefined;
	const close = () => {
		setSearch("");
		setOpen(false);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setSearch("");
				setOpen(next);
			}}
		>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="max-w-56"
						disabled={disabled}
						data-qa-id="git-base-branch-trigger"
					/>
				}
			>
				<GitBranchIcon data-icon="inline-start" />
				<span className="truncate">{effectiveBase ?? "Current branch"}</span>
				<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="bottom"
				sideOffset={6}
				collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
				className="w-72 gap-0 p-0"
				onKeyDown={(event) => {
					if (event.key === "Escape") close();
				}}
			>
				<Command label="Search branches">
					<CommandInput placeholder="Search branches" value={search} onValueChange={setSearch} />
					<CommandList className="scroll-fade max-h-[calc(1.75rem*5)]">
						<CommandEmpty>
							{branches.length === 0 ? "No branches yet." : "No branches found."}
						</CommandEmpty>
						{groupBranches(branches, defaultBase, recentBranches).map((group) => (
							<CommandGroup key={group.identifier} heading={group.heading}>
								{group.items.map((branch) => {
									const label = branchDisplayName(branch);
									return (
										<CommandItem
											key={branch.ref}
											data-qa-id={`git-base-branch-item-${label}`}
											value={label}
											data-checked={branch.name === effectiveBase}
											onSelect={() => {
												onSelect(branch.name);
												close();
											}}
										>
											<GitBranchIcon className="text-muted-foreground" />
											<span className="min-w-0 truncate">{label}</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
