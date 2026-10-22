import { GitBranchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sdkQueryKey, sdkQueryOptions, useSdk, useSdkMutation } from "@kilo-desktop/sdk-react";

import type {
	GitBranch,
	GitServiceContract,
	GitBranchesResult,
	SessionDirectoriesStoreValue,
} from "../contracts/schemas.js";
import { SESSION_DIRECTORIES_STORE_KEY } from "../contracts/schemas.js";
import { branchDisplayName } from "./branch-display-name.js";
import { resolveBranchPick } from "./branch-pick.js";
import { InitializeGitButton } from "./InitializeGitButton.js";
import {
	getPopoverMessage,
	getTriggerLabel,
	isTriggerLoading,
	type LoadingNotice,
	type SelectorQueryState,
	type UnbornNotice,
} from "./branch-selector-state.js";
import { BranchPickerPopover } from "./BranchPickerPopover.js";
import { CreateBranchDialog } from "./CreateBranchDialog.js";
import { setSelection } from "./draft-selection-store.js";
import { SwitchWorktreeBranchDialog } from "./SwitchWorktreeBranchDialog.js";
import { linkedWorktrees, worktreesQueryOptions } from "./worktree-queries.js";

export interface GitBranchSelectorProps {
	/**
	 * Id of the active workspace; needed to write a retarget selection.
	 * Absent when the chat is unscoped.
	 */
	readonly workspaceId?: string | undefined;
	/**
	 * The repository's checkout — "Local" in the draft mode menu, and the
	 * directory the worktree list (retarget candidates) is queried against.
	 * Absent when the chat is unscoped.
	 */
	readonly workspaceDirectory?: string | undefined;
	/**
	 * Working directory to operate on: the checkout target. Equals
	 * `workspaceDirectory` in local mode; a worktree's directory in
	 * existing-worktree mode. Defaults to `workspaceDirectory` when
	 * omitted. Absent when the chat is unscoped — the selector stays
	 * rendered and says so in its popover.
	 */
	readonly workingDirectory?: string | undefined;
}

const EMPTY_BRANCHES: ReadonlyArray<GitBranch> = [];
const EMPTY_RECENT: ReadonlyArray<string> = [];

/**
 * Popover body for an unborn-HEAD repository: no history to list, so
 * the branch picker explains why instead of showing an empty list.
 */
function UnbornNoticeContent() {
	return (
		<div className="flex flex-col gap-2">
			<p className="text-sm font-medium tracking-tight">No history found in this branch</p>
			<p className="text-muted-foreground text-sm/relaxed">
				We can&apos;t complete this action. This can happen with a brand new repository that
				doesn&apos;t have any commits yet.
			</p>
			<p className="text-muted-foreground text-sm/relaxed">
				If this isn&apos;t a new repository, git is likely in an unborn HEAD state.
			</p>
		</div>
	);
}

/**
 * Popover body while a probe is in flight. `role="status"` sits on the
 * wrapper and the spinner is hidden so screen readers announce
 * "Loading…" once, not twice.
 */
function LoadingNoteContent() {
	return (
		<span role="status" className="flex items-center gap-2">
			<Spinner className="size-3.5" aria-hidden="true" />
			Loading…
		</span>
	);
}

/** Structured notices get their own component; plain strings render as is. */
function noticeContent(notice: UnbornNotice | LoadingNotice): ReactNode {
	switch (notice.kind) {
		case "unborn":
			return <UnbornNoticeContent />;
		case "loading":
			return <LoadingNoteContent />;
	}
}

/** Browser-safe basename fallback for the confirm dialog while the worktree list is still loading. */
function directoryBasename(directory: string): string {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] ?? directory;
}

/**
 * Branch switcher contributed to the composer draft footer zone
 * (`kilo-ui/chat-composer-draft-footer`), rendered in the toolbar strip
 * right after the workspace selector. A workspace the probe reports as
 * `missing` swaps the whole selector for the shared Initialize Git
 * action — a successful init invalidates `repositoryType`, and the
 * refetch (now `regular`) lands back on the trigger. Every other state
 * keeps the dedicated trigger, always rendered and always clickable;
 * the repository-type probe decides what the popover shows, and only a
 * regular repository ever fetches the branch list. The popover itself
 * is the shared `BranchPickerPopover` (grouped and searchable like
 * GitHub Desktop); this component owns the checkout side: a
 * pending-branch optimistic trigger label, the mutation with its error
 * toast, and the create-and-checkout dialog (optionally based on the
 * detected default branch when it differs
 * from the current one, per Desktop's dialog).
 */
export function GitBranchSelector({
	workspaceId,
	workspaceDirectory,
	workingDirectory: workingDirectoryProp,
}: GitBranchSelectorProps) {
	const workingDirectory = workingDirectoryProp ?? workspaceDirectory;
	const sdk = useSdk<GitServiceContract>("git");
	const queryClient = useQueryClient();
	// Disabled rather than stubbed when there is no workspace directory: a
	// stub input would fail contract validation on every mount.
	const typeQuery = useQuery({
		...sdkQueryOptions(sdk, "repositoryType", { workingDirectory: workingDirectory ?? "" }),
		enabled: workingDirectory !== undefined,
	});
	const isRegular = typeQuery.data?.kind === "regular";
	const query = useQuery({
		...sdkQueryOptions(sdk, "branches", { workingDirectory: workingDirectory ?? "" }),
		enabled: workingDirectory !== undefined && isRegular,
	});
	const data = query.data;
	// Always keyed by the *workspace* directory (never the worktree), so
	// this query shares a cache entry with `GitDraftMenus`' submenu list.
	const worktreesQuery = useQuery({
		...worktreesQueryOptions(sdk, workspaceDirectory ?? ""),
		enabled: workspaceDirectory !== undefined,
	});
	const [createOpen, setCreateOpen] = useState(false);
	const [createName, setCreateName] = useState("");
	const [createError, setCreateError] = useState<string | undefined>();
	const [pending, setPending] = useState<{ directory: string; branch: string } | undefined>();
	// The one new hook this feature adds (hook budget, `rerender-defer-reads`):
	// the pending branch name awaiting the switch-worktree-branch confirm.
	// Session counts are read on demand in the handler, never subscribed to.
	const [pendingConfirmBranch, setPendingConfirmBranch] = useState<string | undefined>();
	const checkout = useSdkMutation(sdk, "checkout", {
		invalidates: ["branches", "status", "worktrees"],
	});

	// The swap is derived during render from the already-subscribed probe —
	// no extra subscription or effect. It must sit below every hook above
	// (rules-of-hooks); the helpers below it are plain functions.
	if (workingDirectory !== undefined && typeQuery.data?.kind === "missing") {
		return (
			<InitializeGitButton
				workspaceDirectory={workingDirectory}
				size="sm"
				testId="git-init-draft-button"
			/>
		);
	}

	const state: SelectorQueryState = {
		workspaceDirectory: workingDirectory,
		// A disabled query is forever pending — only report "checking"
		// once there is a directory to probe.
		isChecking: workingDirectory !== undefined && typeQuery.isPending,
		isRegular,
		typeFailed: typeQuery.isError,
		// Same forever-pending caveat: the branches query only runs for
		// regular repositories.
		branchesPending: isRegular && query.isPending,
		branchesFailed: isRegular && query.isError,
		data,
	};
	const pendingBranch =
		pending !== undefined && pending.directory === (workingDirectory ?? "")
			? pending.branch
			: undefined;
	const label = getTriggerLabel(state, pendingBranch);
	const popoverMessage = getPopoverMessage(state);
	const listData: GitBranchesResult | null =
		popoverMessage === null && data !== undefined && data !== null ? data : null;

	// Shared by the branch items and the create dialog. Selecting a
	// branch closes the popover first so the switch feels instant;
	// create still waits for success before dismissing the dialog.
	const runCheckout = (
		branch: string,
		create: boolean,
		startPoint: string | undefined,
		onSuccess: (() => void) | undefined,
		kind?: GitBranch["kind"],
	) => {
		checkout.mutate(
			{
				workingDirectory: workingDirectory ?? "",
				branch,
				...(kind === "remote" ? { kind } : {}),
				...(create ? { create, ...(startPoint !== undefined ? { startPoint } : {}) } : {}),
			},
			{
				...(onSuccess !== undefined ? { onSuccess } : {}),
				// Create failures stay inline in the still-open dialog; switch
				// failures toast because the popover has already closed.
				// Invalid branch names are rejected by git itself and surface
				// the same way as every other checkout error.
				onError: (error) => {
					setPending(undefined);
					if (create) {
						setCreateError(error instanceof Error ? error.message : "Unknown git error.");
						return;
					}
					toast.error("Could not switch branches", {
						description: error instanceof Error ? error.message : "Unknown git error.",
					});
					// Piggyback on the toast path: a stale worktree list is the
					// most likely reason a retarget didn't happen (e.g.
					// `BranchAlreadyCheckedOut`), so the next pick retargets.
					void queryClient.invalidateQueries({
						queryKey: sdkQueryKey(sdk, "worktrees", { workingDirectory: workspaceDirectory ?? "" }),
					});
				},
			},
		);
	};

	/**
	 * Picking a branch either retargets the draft silently (no checkout, no
	 * toast — the branch is already checked out somewhere else in the
	 * workspace), opens the switch-worktree-branch confirm when sessions
	 * already use this worktree, or checks out normally. Decision logic is
	 * pure (`resolveBranchPick`); this handler only dispatches on it
	 * (`rerender-move-effect-to-event`: the whole thing runs in the click
	 * handler, no effect).
	 */
	const handleBranchPick = (selected: GitBranch) => {
		const resolution = resolveBranchPick({
			branch: selected.name,
			worktrees: worktreesQuery.data,
			workspaceDirectory: workspaceDirectory ?? "",
			workingDirectory: workingDirectory ?? "",
		});
		if (resolution.kind === "retarget") {
			if (workspaceId !== undefined) setSelection(sdk, workspaceId, resolution.selection);
			return;
		}
		const targetsWorktree =
			workingDirectory !== undefined && workingDirectory !== workspaceDirectory;
		// In-sync sessions only: sessions whose creation-time branch stamp
		// still equals what this worktree actually has checked out right
		// now (`data.currentBranch`). After a confirmed switch the old
		// sessions' stamps no longer match, so repeat switches skip the
		// prompt until a new session re-stamps the worktree's branch.
		const sessionCount = targetsWorktree
			? (sdk.state.get<SessionDirectoriesStoreValue>(SESSION_DIRECTORIES_STORE_KEY).peek()?.[
					workingDirectory
				]?.[data?.currentBranch ?? ""] ?? 0)
			: 0;
		if (sessionCount > 0) {
			setPendingConfirmBranch(selected.name);
			return;
		}
		setPending({ directory: workingDirectory ?? "", branch: branchDisplayName(selected) });
		runCheckout(selected.name, false, undefined, undefined, selected.kind);
	};

	const note =
		popoverMessage !== null && typeof popoverMessage === "object"
			? noticeContent(popoverMessage)
			: popoverMessage;
	const pendingConfirmSessionCount =
		pendingConfirmBranch !== undefined && workingDirectory !== undefined
			? (sdk.state.get<SessionDirectoriesStoreValue>(SESSION_DIRECTORIES_STORE_KEY).peek()?.[
					workingDirectory
				]?.[data?.currentBranch ?? ""] ?? 0)
			: 0;
	const pendingConfirmWorktreeName =
		workingDirectory !== undefined
			? (linkedWorktrees(worktreesQuery.data, workspaceDirectory ?? "").find(
					(entry) => entry.path === workingDirectory,
				)?.name ?? directoryBasename(workingDirectory))
			: "";

	return (
		<>
			<BranchPickerPopover
				triggerIcon={<GitBranchIcon data-icon="inline-start" />}
				triggerLabel={label}
				triggerLoading={isTriggerLoading(state, pendingBranch)}
				triggerTestId="git-branch-selector-trigger"
				branches={listData?.branches ?? EMPTY_BRANCHES}
				defaultBranch={listData?.defaultBranch}
				recentBranches={listData?.recentBranches ?? EMPTY_RECENT}
				checkedBranch={listData?.currentBranch}
				itemsDisabled={checkout.isPending}
				itemTestIdPrefix="git-branch-item-"
				note={note}
				noteTestId="git-branch-selector-note"
				onSelect={handleBranchPick}
				onCreateBranch={(searchText) => {
					setCreateName(searchText);
					// A stale error from a previous attempt must not survive into a fresh dialog.
					setCreateError(undefined);
					setCreateOpen(true);
				}}
			/>
			{createOpen ? (
				<CreateBranchDialog
					initialName={createName}
					isPending={checkout.isPending}
					errorMessage={createError}
					defaultBranch={data?.defaultBranch}
					currentBranch={data?.currentBranch}
					onClearError={() => {
						setCreateError(undefined);
					}}
					onCancel={() => {
						setCreateOpen(false);
						setCreateError(undefined);
					}}
					onCreate={(name, startPoint) => {
						// Clear before the attempt so a stale error does not
						// linger while the retry is in flight.
						setCreateError(undefined);
						runCheckout(name, true, startPoint, () => {
							setCreateOpen(false);
						});
					}}
				/>
			) : null}
			{pendingConfirmBranch !== undefined ? (
				<SwitchWorktreeBranchDialog
					open
					onOpenChange={(open) => {
						if (!open) setPendingConfirmBranch(undefined);
					}}
					worktreeName={pendingConfirmWorktreeName}
					branch={pendingConfirmBranch}
					sessionCount={pendingConfirmSessionCount}
					onConfirm={() => {
						const branch = pendingConfirmBranch;
						const selectedKind = listData?.branches.find((entry) => entry.name === branch)?.kind;
						setPendingConfirmBranch(undefined);
						setPending({ directory: workingDirectory ?? "", branch });
						runCheckout(branch, false, undefined, undefined, selectedKind);
					}}
				/>
			) : null}
		</>
	);
}
