import { GitBranchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	WorkSessions,
	type NewWorkSessionOptionProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { Repository, type GitBranch, type GitBranchesResult } from "../../contracts";
import {
	branchesQuery,
	invalidateRepositoryQueries,
	repositoryQueryKey,
	repositoryTypeQuery,
	worktreesQuery,
} from "../shared/repository-queries";
import { branchDisplayName } from "./branch-display-name";
import { resolveBranchPick } from "./branch-pick";
import {
	getPopoverMessage,
	getTriggerLabel,
	isTriggerLoading,
	type LoadingNotice,
	type SelectorQueryState,
	type UnbornNotice,
} from "./branch-selector-state";
import { BranchPickerPopover } from "./BranchPickerPopover";
import { CreateBranchDialog } from "./CreateBranchDialog";
import { SwitchWorktreeBranchDialog } from "./SwitchWorktreeBranchDialog";

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

interface CheckoutInput {
	readonly branch: string;
	readonly create?: boolean;
	readonly startPoint?: string | undefined;
	readonly kind?: GitBranch["kind"] | undefined;
}

/** Work sessions working in `directory` on `branch`: they would see its branch change under them. */
function useWorkSessionsOnBranch(directory: string, branch: string | undefined): number {
	return (
		useDomainObjectState(WorkSessions, (state: DomainObjectState<typeof WorkSessions>) =>
			branch === undefined
				? 0
				: state.workSessions.filter(
						(workSession) => workSession.directory === directory && workSession.branch === branch,
					).length,
		) ?? 0
	);
}

/**
 * The New Session page's branch picker
 * (`kilo.work-sessions/new-work-session-option`, slot `branch`) for the folder
 * a new work session would work in: the checkout in
 * Local mode, or the existing worktree picked. Grouped and searchable like
 * GitHub Desktop (`BranchPickerPopover`); this component owns the checkout
 * side: an optimistic trigger label while switching, the error toast, and
 * the create-and-checkout dialog (optionally based on the default branch
 * when it differs from the current one). Picking a branch already checked
 * out in another worktree of the repository moves the New Session page there
 * instead of checking it out; switching a worktree other work sessions work on
 * asks first.
 */
export function GitBranchSelector({
	repositoryDirectory,
	directory: workingDirectory,
	onIsolationChange,
	onChanged,
	disabled,
}: NewWorkSessionOptionProps) {
	const repository = useDomainObject(Repository);
	const queries = useQueryClient();
	// Switching workspace keeps the previous folder's branch on screen until the new one's
	// arrives, instead of flashing a loading state in the New Session page's capsule.
	const typeQuery = useQuery({
		...repositoryTypeQuery(repository, workingDirectory),
		placeholderData: keepPreviousData,
	});
	const isRegular = typeQuery.data?.kind === "regular";
	const query = useQuery({
		...branchesQuery(repository, workingDirectory),
		enabled: repository !== null && isRegular,
		placeholderData: keepPreviousData,
	});
	const data = query.data;
	const worktrees = useQuery(worktreesQuery(repository, repositoryDirectory));
	const [createOpen, setCreateOpen] = useState(false);
	const [createName, setCreateName] = useState("");
	const [createError, setCreateError] = useState<string | undefined>();
	const [pending, setPending] = useState<{ directory: string; branch: string } | undefined>();
	const [pendingConfirmBranch, setPendingConfirmBranch] = useState<string | undefined>();
	const targetsWorktree = workingDirectory !== repositoryDirectory;
	const sessionCount = useWorkSessionsOnBranch(
		workingDirectory,
		targetsWorktree ? (data?.currentBranch ?? undefined) : undefined,
	);
	const checkout = useMutation({
		mutationFn: (input: CheckoutInput) =>
			repository
				? repository.methods.checkout({
						directory: workingDirectory,
						branch: input.branch,
						...(input.kind === "remote" ? { kind: input.kind } : {}),
						...(input.create
							? {
									create: true,
									...(input.startPoint !== undefined ? { startPoint: input.startPoint } : {}),
								}
							: {}),
					})
				: Promise.reject(new Error("Git isn't available.")),
		onSuccess: async () => {
			await invalidateRepositoryQueries(queries, ["branches", "status", "worktrees"]);
			onChanged();
		},
	});

	const state: SelectorQueryState = {
		workspaceDirectory: workingDirectory,
		isChecking: repository !== null && typeQuery.isPending,
		isRegular,
		typeFailed: repository === null || typeQuery.isError,
		branchesPending: isRegular && query.isPending,
		branchesFailed: isRegular && query.isError,
		data,
	};
	const pendingBranch = pending?.directory === workingDirectory ? pending.branch : undefined;
	const label = getTriggerLabel(state, pendingBranch);
	const popoverMessage = getPopoverMessage(state);
	const listData: GitBranchesResult | null =
		popoverMessage === null && data !== undefined && data !== null ? data : null;

	// Selecting a branch closes the popover first so the switch feels
	// instant; create waits for success before dismissing its dialog.
	const runCheckout = (input: CheckoutInput, onSuccess?: () => void) => {
		checkout.mutate(input, {
			...(onSuccess !== undefined ? { onSuccess } : {}),
			// Create failures stay inline in the still-open dialog; switch
			// failures toast because the popover has already closed.
			onError: (error) => {
				setPending(undefined);
				if (input.create) {
					setCreateError(error instanceof Error ? error.message : "Unknown git error.");
					return;
				}
				toast.error("Could not switch branches", {
					description: error instanceof Error ? error.message : "Unknown git error.",
				});
				// A stale worktree list is the likeliest reason a move didn't
				// happen (`BranchAlreadyCheckedOut`), so the next pick moves.
				void queries.invalidateQueries({
					queryKey: repositoryQueryKey("worktrees", repositoryDirectory),
				});
			},
		});
	};

	// A pick made before the worktree list arrived waits for it, so it still
	// moves to a worktree that has the branch instead of failing to check out.
	const handleBranchPick = async (selected: GitBranch) => {
		const worktreeList =
			worktrees.data ??
			(await queries
				.ensureQueryData(worktreesQuery(repository, repositoryDirectory))
				.catch(() => null));
		const resolution = resolveBranchPick({
			branch: selected.name,
			worktrees: worktreeList,
			repositoryDirectory,
			workingDirectory,
		});
		if (resolution.kind === "retarget") {
			onIsolationChange(resolution.isolation);
			return;
		}
		if (sessionCount > 0) {
			setPendingConfirmBranch(selected.name);
			return;
		}
		setPending({ directory: workingDirectory, branch: branchDisplayName(selected) });
		runCheckout({ branch: selected.name, kind: selected.kind });
	};

	const note =
		popoverMessage !== null && typeof popoverMessage === "object"
			? noticeContent(popoverMessage)
			: popoverMessage;
	const pendingConfirmWorktreeName =
		worktrees.data?.find((entry) => entry.path === workingDirectory)?.name ??
		directoryBasename(workingDirectory);

	return (
		<>
			<BranchPickerPopover
				triggerIcon={<GitBranchIcon data-icon="inline-start" />}
				triggerLabel={label}
				triggerLoading={isTriggerLoading(state, pendingBranch)}
				// The previous folder's list stays up while this one loads; not pickable meanwhile.
				triggerDisabled={disabled || query.isPlaceholderData}
				triggerTestId="git-branch-selector-trigger"
				branches={listData?.branches ?? EMPTY_BRANCHES}
				defaultBranch={listData?.defaultBranch}
				recentBranches={listData?.recentBranches ?? EMPTY_RECENT}
				checkedBranch={listData?.currentBranch}
				itemsDisabled={checkout.isPending}
				itemTestIdPrefix="git-branch-item-"
				note={note}
				noteTestId="git-branch-selector-note"
				onSelect={(selected) => void handleBranchPick(selected)}
				onCreateBranch={(searchText) => {
					setCreateName(searchText);
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
					onClearError={() => setCreateError(undefined)}
					onCancel={() => {
						setCreateOpen(false);
						setCreateError(undefined);
					}}
					onCreate={(name, startPoint) => {
						setCreateError(undefined);
						runCheckout({ branch: name, create: true, startPoint }, () => setCreateOpen(false));
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
					sessionCount={sessionCount}
					onConfirm={() => {
						const branch = pendingConfirmBranch;
						const kind = listData?.branches.find((entry) => entry.name === branch)?.kind;
						setPendingConfirmBranch(undefined);
						setPending({ directory: workingDirectory, branch });
						runCheckout({ branch, kind });
					}}
				/>
			) : null}
		</>
	);
}
