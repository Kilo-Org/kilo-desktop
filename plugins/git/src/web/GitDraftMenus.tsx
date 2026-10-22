import { ChevronDownIcon, FolderIcon, GitForkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import useLocalStorage from "react-use/esm/useLocalStorage";

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
import { useQuery } from "@tanstack/react-query";
import { sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";

import type { GitBranch, GitServiceContract } from "../contracts/schemas.js";
import { BaseBranchPicker } from "./BaseBranchPicker.js";
import { GitBranchSelector } from "./GitBranchSelector.js";
import { InitializeGitButton } from "./InitializeGitButton.js";
import { setSelection } from "./draft-selection-store.js";
import { useDraftSelection } from "./use-draft-selection.js";
import { linkedWorktrees, worktreesQueryOptions } from "./worktree-queries.js";

/*
	Draft mode preference: "local" | "worktree", persisted as JSON under
	git.draftMode:v1 (version-suffixed per git.diffOptions:v1 precedent).

	Exactly one useLocalStorage instance for this key may exist — react-use
	does not sync same-tab instances (see diff-options.tsx ownership comment).
	GitDraftMenus is the sole mount point for the draft footer, so the
	single-instance invariant holds for the app's lifetime. If a second
	consumer appears, hoist to a provider like DiffConfigProvider.

	Sanitize-on-read: anything other than exactly "worktree" resolves to
	"local" so hand-edited or corrupt storage can never accidentally activate
	worktree mode (the safe direction — consistent with null → local).

	The seeding effect never writes localStorage; only the radio onValueChange
	does (explicit user interaction, not a side-effect — rule 5.8).
*/
export const DRAFT_MODE_STORAGE_KEY = "git.draftMode:v1";

// Module-level fallbacks so unset query data never allocates a fresh array
// per render.
const EMPTY_BRANCHES: ReadonlyArray<GitBranch> = [];
const EMPTY_RECENT: ReadonlyArray<string> = [];

/**
 * Fallback trigger label while the worktree list is still loading (the
 * selected directory has not yet matched an entry). Browser-safe
 * (no `node:path`): split on both separators, same as the main-process
 * `basename` mapping produces.
 */
function worktreeDirectoryBasename(directory: string): string {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] ?? directory;
}

/**
 * Worktree items are keyed by path but searched by their name/branch
 * keywords only — every path shares `.kilo/worktrees/`, so matching it
 * would make most queries match everything.
 */
function filterWorktreeItems(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

export interface GitDraftMenusProps {
	/**
	 * Primary folder path of the active workspace; absent when the chat is
	 * unscoped.
	 */
	readonly workspaceDirectory?: string | undefined;
	/**
	 * Id of the active workspace; the draft git selection is keyed by it.
	 * Absent when the chat is unscoped.
	 */
	readonly workspaceId?: string | undefined;
}

/**
 * The draft-footer git zone contribution (wrapping the `feat/git-branch`
 * selector): a mode dropdown deciding where the next session runs — the
 * local checkout, a fresh worktree, or an already-registered worktree —
 * plus the per-mode control. A workspace the repository-type probe
 * reports as `missing` swaps the whole footer for the shared Initialize
 * Git action; a successful init invalidates `repositoryType`, and the
 * refetch (now `regular`) renders the mode UI. Local mode is the default;
 * the user's choice is persisted to localStorage so fresh workspaces and
 * future app runs start from the last-chosen mode — persistence only ever
 * covers `local`/`worktree` (`git.draftMode:v1`); picking an existing
 * worktree is a one-off in-memory choice, never persisted, and never
 * touches that storage key. Local mode keeps the existing checkout
 * selector; worktree mode shows the base-branch picker; an existing
 * worktree also uses the checkout selector, pointed at the worktree's
 * directory instead of the workspace's. The "Existing worktrees" submenu
 * (goal 3) lists the workspace's linked worktrees (`worktreesQueryOptions`,
 * shared cache key with `GitBranchSelector`'s retarget check) and is
 * hidden whenever that list is empty. The submenu body is a cmdk list
 * with a search input filtering by worktree name and branch (shadcn's
 * combobox-dropdown-menu pattern), since a repository can accumulate
 * many worktrees; the menu is controlled so a cmdk pick can close it.
 * Picking an entry writes `{ mode: "existing-worktree", directory }`
 * directly, bypassing the top radio group entirely (its value is `""`
 * while an existing worktree is selected, since Base UI radio groups
 * cannot span two `DropdownMenuSub` boundaries). The selection lives in the git-owned
 * `git.draft-worktree-selection` state store keyed by workspace id, which
 * kilo-ui reads at send time to steer session creation.
 */
export function GitDraftMenus({ workspaceDirectory, workspaceId }: GitDraftMenusProps) {
	const sdk = useSdk<GitServiceContract>("git");
	const selection = useDraftSelection(sdk, workspaceId);
	// Controlled so a cmdk item in the existing-worktrees submenu (not a
	// Base UI menu item, so no `closeOnClick`) can close the whole menu.
	const [menuOpen, setMenuOpen] = useState(false);

	// Sanitize-on-read: only exact "worktree" activates worktree mode.
	const [storedMode, setStoredMode] = useLocalStorage(DRAFT_MODE_STORAGE_KEY, "local");
	const preferredMode = storedMode === "worktree" ? "worktree" : "local";

	const scoped = workspaceDirectory !== undefined && workspaceId !== undefined;
	const typeQuery = useQuery({
		...sdkQueryOptions(sdk, "repositoryType", { workingDirectory: workspaceDirectory ?? "" }),
		enabled: scoped,
	});
	const isRegular = typeQuery.data?.kind === "regular";
	const branchesQuery = useQuery({
		...sdkQueryOptions(sdk, "branches", { workingDirectory: workspaceDirectory ?? "" }),
		enabled: scoped && isRegular,
	});
	const defaultBranchQuery = useQuery({
		...sdkQueryOptions(sdk, "defaultBranch", { workingDirectory: workspaceDirectory ?? "" }),
		enabled: scoped && isRegular,
	});
	const worktreesQuery = useQuery({
		...worktreesQueryOptions(sdk, workspaceDirectory ?? ""),
		enabled: scoped && isRegular,
	});
	const existingWorktrees = linkedWorktrees(worktreesQuery.data, workspaceDirectory ?? "");

	// A repo with no branches has no commits — `worktree add` needs a
	// commitish, so worktree mode is disabled for it. Data is `undefined`
	// while loading and `null` for a non-repo; only a resolved, empty
	// branch list means unborn.
	const unborn = branchesQuery.data != null && branchesQuery.data.branches.length === 0;

	// First mount per workspace with no store entry: seed from the persisted
	// preference. Local is the default mode (new users and empty localStorage
	// both resolve to local). For local preference, seed as soon as the
	// repository-type probe settles — no need to wait for branch queries,
	// avoiding a flash of the worktree base picker on the common path. For
	// worktree preference, wait for both branch probes (needed for the
	// default base and the unborn-repo guard). The effect never writes
	// localStorage — only onValueChange does (explicit user action).
	useEffect(() => {
		if (workspaceId === undefined || selection !== null || !isRegular) return;
		if (preferredMode === "local") {
			setSelection(sdk, workspaceId, { mode: "local" });
			return;
		}
		// preferredMode === "worktree"
		if (!branchesQuery.isSuccess || !defaultBranchQuery.isSuccess) return;
		if (unborn) {
			setSelection(sdk, workspaceId, { mode: "local" });
			return;
		}
		const defaultBase = defaultBranchQuery.data;
		setSelection(
			sdk,
			workspaceId,
			defaultBase === null ? { mode: "worktree" } : { mode: "worktree", baseBranch: defaultBase },
		);
	}, [
		sdk,
		workspaceId,
		selection,
		isRegular,
		preferredMode,
		branchesQuery.isSuccess,
		defaultBranchQuery.isSuccess,
		defaultBranchQuery.data,
		unborn,
	]);

	// Missing-repo swap (after all hooks, before the regular-repo UI): the
	// probe only runs when scoped, and without a repo no worktree can
	// exist — so the workspace directory is the right init target. While
	// the probe is pending, and for other non-regular kinds, stay hidden.
	if (workspaceDirectory !== undefined && typeQuery.data?.kind === "missing") {
		return (
			<InitializeGitButton
				workspaceDirectory={workspaceDirectory}
				size="sm"
				testId="git-init-draft-button"
			/>
		);
	}

	if (!scoped || !isRegular) return null;

	const mode = selection?.mode;
	const workingDirectory =
		selection?.mode === "existing-worktree" ? selection.directory : workspaceDirectory;
	const existingWorktreeName =
		selection?.mode === "existing-worktree"
			? (existingWorktrees.find((entry) => entry.path === selection.directory)?.name ??
				worktreeDirectoryBasename(selection.directory))
			: undefined;
	const modeLabel =
		selection === null
			? "Git"
			: mode === "local"
				? "Local"
				: mode === "existing-worktree"
					? (existingWorktreeName ?? "Existing worktree")
					: "New worktree";

	return (
		<>
			<DropdownMenu
				open={menuOpen}
				onOpenChange={(open) => {
					setMenuOpen(open);
					if (open && scoped && isRegular) void worktreesQuery.refetch();
				}}
			>
				<DropdownMenuTrigger
					render={
						<Button type="button" variant="ghost" size="sm" data-qa-id="git-draft-mode-trigger" />
					}
				>
					{mode === "worktree" || mode === "existing-worktree" ? (
						<GitForkIcon data-icon="inline-start" />
					) : (
						<FolderIcon data-icon="inline-start" />
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
							value={mode ?? ""}
							onValueChange={(value) => {
								if (workspaceId === undefined || (value !== "local" && value !== "worktree")) {
									return;
								}
								if (value === "worktree" && unborn) return;
								// Re-entering worktree mode seeds the default branch
								// again so the picker and the send always show an
								// explicit base.
								const defaultBase = defaultBranchQuery.data ?? null;
								setSelection(
									sdk,
									workspaceId,
									value === "worktree" && defaultBase !== null
										? { mode: "worktree", baseBranch: defaultBase }
										: { mode: value },
								);
								setStoredMode(value);
							}}
						>
							{unborn ? (
								<Tooltip>
									<TooltipTrigger
										render={
											<DropdownMenuRadioItem
												value="worktree"
												disabled
												data-qa-id="git-draft-mode-item-worktree"
											>
												<span className="flex min-w-0 flex-col gap-0.5">
													<span>New worktree</span>
													<span className="text-muted-foreground text-xs">
														Creates a separate copy for this session
													</span>
												</span>
											</DropdownMenuRadioItem>
										}
									/>
									<TooltipContent>
										This repository has no commits yet. Create an initial commit to use worktrees.
									</TooltipContent>
								</Tooltip>
							) : (
								<DropdownMenuRadioItem
									value="worktree"
									closeOnClick
									data-qa-id="git-draft-mode-item-worktree"
								>
									<span className="flex min-w-0 flex-col gap-0.5">
										<span>New worktree</span>
										<span className="text-muted-foreground text-xs">
											Creates a separate copy for this session
										</span>
									</span>
								</DropdownMenuRadioItem>
							)}
							<DropdownMenuRadioItem
								value="local"
								closeOnClick
								data-qa-id="git-draft-mode-item-local"
							>
								<span className="flex min-w-0 flex-col gap-0.5">
									<span>Local repository</span>
									<span className="text-muted-foreground text-xs">
										Works in the repository already on your machine
									</span>
								</span>
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					{existingWorktrees.length > 0 ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuSub>
									<DropdownMenuSubTrigger data-qa-id="git-draft-mode-sub-existing">
										<GitForkIcon data-icon="inline-start" />
										<span className="truncate">Existing worktrees</span>
									</DropdownMenuSubTrigger>
									{/* shadcn's combobox-dropdown-menu pattern: a cmdk list inside
									    the submenu. Fixed width so filtering never resizes it. */}
									<DropdownMenuSubContent className="w-72 p-0">
										<Command
											label="Search worktrees"
											filter={filterWorktreeItems}
											onKeyDown={(event) => {
												// cmdk handles its own keys on this element after this
												// prop; stopping the bubble keeps Base UI's menu
												// typeahead / ArrowLeft-close off the search input.
												// Base UI doesn't dismiss on an Escape from inside the
												// input, so close explicitly (as BranchPickerPopover does).
												event.stopPropagation();
												if (event.key === "Escape") setMenuOpen(false);
											}}
										>
											<CommandInput
												autoFocus
												placeholder="Search worktrees"
												data-qa-id="git-draft-mode-existing-search"
											/>
											{/* Fixed height (not max-h), like shadcn's docs command
											    palette: the submenu sits near the window bottom and
											    Base UI shifts it up to fit, so a list that shrank while
											    filtering would make it jump. Sized like the Combobox
											    list: 18rem minus the search row, clamped to the
											    available height. */}
											<CommandList className="scroll-fade h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))]">
												<CommandEmpty>No worktrees found.</CommandEmpty>
												<CommandGroup>
													{existingWorktrees.map((entry) => (
														<CommandItem
															key={entry.path}
															value={entry.path}
															keywords={[entry.name, entry.branch]}
															data-checked={
																selection?.mode === "existing-worktree" &&
																selection.directory === entry.path
															}
															data-qa-id={`git-draft-mode-item-existing-${entry.name}`}
															onSelect={() => {
																if (workspaceId === undefined) return;
																setSelection(sdk, workspaceId, {
																	mode: "existing-worktree",
																	directory: entry.path,
																});
																setMenuOpen(false);
															}}
														>
															<span className="flex min-w-0 flex-col gap-0.5">
																<span className="truncate">{entry.name}</span>
																<span className="text-muted-foreground truncate text-xs">
																	{entry.branch}
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
			{/* The unseeded render (selection still null) shows the local/default
				UI — deriving the default during render instead of letting the
				seeding effect's timing leak a worktree picker frame. */}
			{mode === "worktree" ? (
				<BaseBranchPicker
					selectedBase={selection?.mode === "worktree" ? selection.baseBranch : undefined}
					defaultBase={defaultBranchQuery.data}
					branches={branchesQuery.data?.branches ?? EMPTY_BRANCHES}
					defaultBranch={branchesQuery.data?.defaultBranch}
					recentBranches={branchesQuery.data?.recentBranches ?? EMPTY_RECENT}
					onSelect={(baseBranch) => {
						if (workspaceId === undefined) return;
						setSelection(
							sdk,
							workspaceId,
							baseBranch === undefined ? { mode: "worktree" } : { mode: "worktree", baseBranch },
						);
					}}
				/>
			) : (
				<GitBranchSelector
					workspaceId={workspaceId}
					workspaceDirectory={workspaceDirectory}
					workingDirectory={workingDirectory}
				/>
			)}
		</>
	);
}
