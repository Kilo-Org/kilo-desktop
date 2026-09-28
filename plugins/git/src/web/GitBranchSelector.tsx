import { GitBranchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { sdkQueryOptions, useSdk, useSdkMutation } from "@kilo-desktop/sdk-react";

import type { GitBranch, GitServiceContract, GitBranchesResult } from "../contracts/schemas.js";
import { branchDisplayName } from "./branch-display-name.js";
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

export interface GitBranchSelectorProps {
	/**
	 * Working directory to operate on. Absent when the chat is unscoped —
	 * the selector stays rendered and says so in its popover.
	 */
	readonly workspaceDirectory?: string | undefined;
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
export function GitBranchSelector({ workspaceDirectory }: GitBranchSelectorProps) {
	const sdk = useSdk<GitServiceContract>("git");
	// Disabled rather than stubbed when there is no workspace directory: a
	// stub input would fail contract validation on every mount.
	const typeQuery = useQuery({
		...sdkQueryOptions(sdk, "repositoryType", { workingDirectory: workspaceDirectory ?? "" }),
		enabled: workspaceDirectory !== undefined,
	});
	const isRegular = typeQuery.data?.kind === "regular";
	const query = useQuery({
		...sdkQueryOptions(sdk, "branches", { workingDirectory: workspaceDirectory ?? "" }),
		enabled: workspaceDirectory !== undefined && isRegular,
	});
	const data = query.data;
	const [createOpen, setCreateOpen] = useState(false);
	const [createName, setCreateName] = useState("");
	const [createError, setCreateError] = useState<string | undefined>();
	const [pending, setPending] = useState<{ directory: string; branch: string } | undefined>();
	const checkout = useSdkMutation(sdk, "checkout", { invalidates: ["branches", "status"] });

	// The swap is derived during render from the already-subscribed probe —
	// no extra subscription or effect. It must sit below every hook above
	// (rules-of-hooks); the helpers below it are plain functions.
	if (workspaceDirectory !== undefined && typeQuery.data?.kind === "missing") {
		return (
			<InitializeGitButton
				workspaceDirectory={workspaceDirectory}
				size="sm"
				testId="git-init-draft-button"
			/>
		);
	}

	const state: SelectorQueryState = {
		workspaceDirectory,
		// A disabled query is forever pending — only report "checking"
		// once there is a directory to probe.
		isChecking: workspaceDirectory !== undefined && typeQuery.isPending,
		isRegular,
		typeFailed: typeQuery.isError,
		// Same forever-pending caveat: the branches query only runs for
		// regular repositories.
		branchesPending: isRegular && query.isPending,
		branchesFailed: isRegular && query.isError,
		data,
	};
	const pendingBranch =
		pending !== undefined && pending.directory === (workspaceDirectory ?? "")
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
				workingDirectory: workspaceDirectory ?? "",
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
				},
			},
		);
	};

	const note =
		popoverMessage !== null && typeof popoverMessage === "object"
			? noticeContent(popoverMessage)
			: popoverMessage;

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
				onSelect={(selected) => {
					setPending({
						directory: workspaceDirectory ?? "",
						branch: branchDisplayName(selected),
					});
					runCheckout(selected.name, false, undefined, undefined, selected.kind);
				}}
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
		</>
	);
}
