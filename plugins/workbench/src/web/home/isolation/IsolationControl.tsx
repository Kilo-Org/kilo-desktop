import { ChevronDownIcon, FolderGit2Icon, GitBranchIcon, LaptopIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type {
	IsolationOptions,
	WorkSessionIsolation,
} from "@kilo-desktop/plugin-sessions/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kilo-desktop/ui/components/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { LocationField } from "../LocationField";
import { BaseBranchPicker } from "./BaseBranchPicker";
import type { IsolationMode } from "./isolation-preference";

/** A repository without commits has no branches; `worktree add` needs a commit. */
export const isUnborn = (options: IsolationOptions) => options.branches.length === 0;

function basename(directory: string): string {
	return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}

/** Worktrees are matched on name and branch only: every path shares `.kilo/worktrees/`. */
function filterWorktreeItems(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

function ModeItem({
	value,
	title,
	description,
	disabled,
}: {
	value: IsolationMode;
	title: string;
	description: string;
	disabled?: boolean;
}) {
	return (
		<DropdownMenuRadioItem
			value={value}
			closeOnClick
			disabled={disabled}
			data-qa-id={`git-draft-mode-item-${value}`}
		>
			<span className="flex min-w-0 flex-col gap-0.5">
				<span>{title}</span>
				<span className="text-muted-foreground text-xs">{description}</span>
			</span>
		</DropdownMenuRadioItem>
	);
}

function BranchLabel({ branch }: { branch: string }) {
	return (
		<span
			data-qa-id="git-branch-label"
			aria-label={`Branch ${branch}`}
			title={branch}
			className="text-foreground/70 flex h-7 min-w-0 items-center gap-1.5 px-2 text-[0.8rem]"
		>
			<GitBranchIcon className="text-foreground/40 size-3.5 shrink-0" aria-hidden />
			<span className="truncate">{branch}</span>
		</span>
	);
}

export interface IsolationControlProps {
	readonly options: IsolationOptions;
	readonly value: WorkSessionIsolation;
	/** `remember` is set when the person picked local or a new worktree. */
	readonly onChange: (value: WorkSessionIsolation, remember?: IsolationMode) => void;
	/** The menu opened: a chance to read the worktrees again. */
	readonly onOpen?: () => void;
	readonly disabled?: boolean;
	/** Takes the place of the read-only branch of `directory` (a contributed branch picker). */
	readonly renderBranch?: ((directory: string) => ReactNode) | undefined;
}

/**
 * Where a new session works, as two of the launcher's location fields: "Runs
 * in" the local repository, a new worktree or one of the workspace's existing
 * worktrees (searchable submenu, hidden when there are none), and the branch:
 * "From" the base branch of a new worktree, otherwise the branch checked out
 * where the session works. New worktrees are disabled for a repository
 * without commits.
 */
export function IsolationControl({
	options,
	value,
	onChange,
	onOpen,
	disabled,
	renderBranch,
}: IsolationControlProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const unborn = isUnborn(options);
	const existing =
		value.kind === "existing-worktree"
			? options.worktrees.find((worktree) => worktree.directory === value.directory)
			: undefined;
	const modeLabel =
		value.kind === "local"
			? "Current checkout"
			: value.kind === "new-worktree"
				? "New worktree"
				: (existing?.name ?? basename(value.directory));
	const branch =
		value.kind === "existing-worktree"
			? existing
				? (renderBranch?.(existing.directory) ?? <BranchLabel branch={existing.branch} />)
				: null
			: value.kind === "local"
				? (renderBranch?.(options.directory) ??
					(options.currentBranch ? <BranchLabel branch={options.currentBranch} /> : null))
				: null;
	const worktreeItem = (
		<ModeItem
			value="worktree"
			title="New worktree"
			description="Creates a separate copy for this session"
			disabled={unborn}
		/>
	);

	return (
		<div data-qa-id="launcher-isolation" className="contents">
			<LocationField label="Use">
				<DropdownMenu
					open={menuOpen}
					onOpenChange={(open) => {
						setMenuOpen(open);
						if (open) onOpen?.();
					}}
				>
					<DropdownMenuTrigger
						disabled={disabled}
						render={
							<Button
								type="button"
								variant="ghost"
								size="sm"
								aria-label="Isolation"
								data-qa-id="git-draft-mode-trigger"
							/>
						}
					>
						{value.kind === "local" ? (
							<LaptopIcon data-icon="inline-start" />
						) : (
							<FolderGit2Icon data-icon="inline-start" />
						)}
						<span className="truncate">{modeLabel}</span>
						<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						side="bottom"
						sideOffset={6}
						collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
						className="w-72"
					>
						<DropdownMenuGroup>
							<DropdownMenuRadioGroup
								value={
									value.kind === "existing-worktree"
										? ""
										: value.kind === "local"
											? "local"
											: "worktree"
								}
								onValueChange={(mode) => {
									if (mode === "local") onChange({ kind: "local" }, "local");
									else if (mode === "worktree" && !unborn) {
										onChange(
											options.defaultBranch
												? { kind: "new-worktree", baseBranch: options.defaultBranch }
												: { kind: "new-worktree" },
											"worktree",
										);
									}
								}}
							>
								{unborn ? (
									<Tooltip>
										<TooltipTrigger render={worktreeItem} />
										<TooltipContent>
											This repository has no commits yet. Create an initial commit to use worktrees.
										</TooltipContent>
									</Tooltip>
								) : (
									worktreeItem
								)}
								<ModeItem
									value="local"
									title="Local repository"
									description="Works in the repository already on your machine"
								/>
							</DropdownMenuRadioGroup>
						</DropdownMenuGroup>
						{options.worktrees.length > 0 ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuGroup>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger data-qa-id="git-draft-mode-sub-existing">
											<FolderGit2Icon data-icon="inline-start" />
											<span className="truncate">Existing worktrees</span>
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="w-72 p-0">
											<Command
												label="Search worktrees"
												filter={filterWorktreeItems}
												onKeyDown={(event) => {
													// Keeps the menu's typeahead off the search input; Escape
													// inside the input doesn't reach the menu, so close here.
													event.stopPropagation();
													if (event.key === "Escape") setMenuOpen(false);
												}}
											>
												<CommandInput
													autoFocus
													placeholder="Search worktrees"
													data-qa-id="git-draft-mode-existing-search"
												/>
												<CommandList className="scroll-fade h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))]">
													<CommandEmpty>No worktrees found.</CommandEmpty>
													<CommandGroup>
														{options.worktrees.map((worktree) => (
															<CommandItem
																key={worktree.directory}
																value={worktree.directory}
																keywords={[worktree.name, worktree.branch]}
																data-checked={
																	value.kind === "existing-worktree" &&
																	value.directory === worktree.directory
																}
																data-qa-id={`git-draft-mode-item-existing-${worktree.name}`}
																onSelect={() => {
																	onChange({
																		kind: "existing-worktree",
																		directory: worktree.directory,
																	});
																	setMenuOpen(false);
																}}
															>
																<span className="flex min-w-0 flex-col gap-0.5">
																	<span className="truncate">{worktree.name}</span>
																	<span className="text-muted-foreground truncate text-xs">
																		{worktree.branch}
																	</span>
																</span>
															</CommandItem>
														))}
													</CommandGroup>
												</CommandList>
											</Command>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								</DropdownMenuGroup>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			</LocationField>
			{value.kind === "new-worktree" ? (
				<LocationField label="Base branch">
					<BaseBranchPicker
						selectedBase={value.baseBranch}
						defaultBase={options.defaultBranch}
						branches={options.branches}
						recentBranches={options.recentBranches}
						disabled={disabled}
						onSelect={(baseBranch) => onChange({ kind: "new-worktree", baseBranch })}
					/>
				</LocationField>
			) : branch ? (
				<LocationField label="Branch">{branch}</LocationField>
			) : null}
		</div>
	);
}
