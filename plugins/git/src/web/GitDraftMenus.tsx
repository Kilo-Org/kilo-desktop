import { ChevronDownIcon, FolderIcon, GitForkIcon } from "lucide-react";
import { useEffect } from "react";
import useLocalStorage from "react-use/esm/useLocalStorage";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
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
 * local checkout or a fresh worktree — plus the per-mode control. A
 * workspace the repository-type probe reports as `missing` swaps the
 * whole footer for the shared Initialize Git action; a successful init
 * invalidates `repositoryType`, and the refetch (now `regular`) renders
 * the mode UI. Local mode is the default; the user's choice is persisted
 * to localStorage so fresh workspaces and future app runs start from the
 * last-chosen mode. Local mode keeps the existing checkout selector;
 * worktree mode shows the base-branch picker. The selection lives in the
 * git-owned `git.draft-worktree-selection` state store keyed by
 * workspace id, which kilo-ui reads at send time to steer session
 * creation.
 */
export function GitDraftMenus({ workspaceDirectory, workspaceId }: GitDraftMenusProps) {
	const sdk = useSdk<GitServiceContract>("git");
	const selection = useDraftSelection(sdk, workspaceId);

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
	const modeLabel = selection === null ? "Git" : mode === "local" ? "Local" : "New worktree";

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button type="button" variant="ghost" size="sm" data-qa-id="git-draft-mode-trigger" />
					}
				>
					{mode === "worktree" ? (
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
				<GitBranchSelector workspaceDirectory={workspaceDirectory} />
			)}
		</>
	);
}
