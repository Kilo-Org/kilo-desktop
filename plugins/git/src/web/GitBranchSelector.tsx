import { ChevronDownIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@anaconda-agentic-desktop/ui/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@anaconda-agentic-desktop/ui/components/popover";
import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";
import { useQuery } from "@tanstack/react-query";
import { sdkQueryOptions, useSdk, useSdkMutation } from "@anaconda-agentic-desktop/sdk-react";

import type { GitBranch, GitServiceContract } from "../contracts/schemas.js";
import { branchDisplayName } from "./branch-display-name.js";
import { groupBranches } from "./group-branches.js";
import { CreateBranchDialog } from "./CreateBranchDialog.js";
import {
	getPopoverMessage,
	getTriggerLabel,
	type SelectorQueryState,
} from "./branch-selector-state.js";

export interface GitBranchSelectorProps {
	/**
	 * Working directory to operate on. Absent when the chat is unscoped —
	 * the selector stays rendered and says so in its popover.
	 */
	readonly workspaceDirectory?: string | undefined;
}

const CREATE_BRANCH_VALUE = "__create-branch__";

function BranchItem({
	branch,
	checked,
	disabled,
	onSelect,
}: {
	branch: GitBranch;
	checked: boolean;
	disabled: boolean;
	onSelect: (branch: GitBranch) => void;
}) {
	const label = branchDisplayName(branch);
	return (
		<CommandItem
			data-qa-id={`git-branch-item-${label}`}
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
 * Branch switcher contributed to the composer draft footer zone
 * (`kilo-ui/chat-composer-draft-footer`), rendered in the toolbar strip
 * right after the workspace selector. The dedicated trigger is always
 * there and always clickable; the repository-type probe decides what
 * the popover shows, and only a regular repository ever fetches the
 * branch list. The list groups branches exactly like GitHub Desktop —
 * "Default Branch" / "Recent Branches" / "Other Branches", local and
 * remote intermingled — computed inline during render (`groupBranches`
 * over a tiny list; memoization deliberately skipped). The popover ends
 * with a pinned "Create branch" item (the workspace picker's "Create
 * workspace" pattern): always visible and enabled outside the
 * scrollable list — cmdk exempts force-mounted items from filtering and
 * from the empty state's match count, and its keyboard nav only covers
 * list items, making this one click-only. Clicking it closes the
 * popover and opens the create dialog, which runs the create-and-checkout
 * flow (optionally based on the detected default branch when it differs
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
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [createName, setCreateName] = useState("");
	const [pending, setPending] = useState<{ directory: string; branch: string } | undefined>();
	const checkout = useSdkMutation(sdk, "checkout", { invalidates: ["branches", "status"] });

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
	const listData = popoverMessage === null && data !== undefined && data !== null ? data : null;

	const trimmedSearch = search.trim();

	// Programmatic closes (branch select, create, Escape) set `open`
	// directly and never reach `onOpenChange`, so they reset the search
	// here to keep a stale value from leaking into the next open.
	const closePopover = () => {
		setSearch("");
		setOpen(false);
	};

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
				// Invalid branch names are rejected by git itself; the failure
				// surfaces the same way as every other checkout error.
				onError: (error) => {
					setPending(undefined);
					toast.error("Could not switch branches", {
						description: error instanceof Error ? error.message : "Unknown git error.",
					});
				},
			},
		);
	};

	return (
		<>
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
							className="dark:text-foreground/90 h-7 max-w-56 rounded-full"
							data-qa-id="git-branch-selector-trigger"
						/>
					}
				>
					<GitBranchIcon data-icon="inline-start" />
					<span className="truncate">{label}</span>
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
					{listData === null ? (
						<div
							data-qa-id="git-branch-selector-note"
							className="text-muted-foreground px-3 py-2.5 text-sm"
						>
							{popoverMessage ?? ""}
						</div>
					) : (
						<Command
							label="Search branches"
							className="[&_[data-slot=command-input-wrapper]]:gap-1.5 [&_[data-slot=command-input-wrapper]]:px-2 [&_[data-slot=command-input-wrapper]]:py-2 [&_[data-slot=command-item]]:gap-1.5 [&_[data-slot=command-item]]:rounded-md [&_[data-slot=command-item]]:px-1.5 [&_[data-slot=command-item]]:py-1 [&_[data-slot=command-item]_[data-slot=button]]:size-5 [&_[data-slot=command-item]_span:has(>svg.lucide-check)]:size-5"
						>
							<CommandInput
								placeholder="Search branches…"
								value={search}
								onValueChange={setSearch}
								className="w-0 min-w-0 flex-1"
							/>
							<CommandSeparator />
							<CommandList className="scroll-fade max-h-[calc(1.75rem*5+0.5rem)]">
								<CommandEmpty>
									{listData.branches.length === 0 ? "No branches yet." : "No branches found."}
								</CommandEmpty>
								{groupBranches(
									listData.branches,
									listData.defaultBranch,
									listData.recentBranches,
								).map((group) => (
									<CommandGroup key={group.identifier} heading={group.heading}>
										{group.items.map((branch) => (
											<BranchItem
												key={branch.ref}
												branch={branch}
												checked={branch.name === listData.currentBranch}
												disabled={checkout.isPending}
												onSelect={(selected) => {
													setPending({
														directory: workspaceDirectory ?? "",
														branch: branchDisplayName(selected),
													});
													closePopover();
													runCheckout(selected.name, false, undefined, undefined, selected.kind);
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
							<CommandSeparator />
							<CommandGroup forceMount>
								<CommandItem
									data-qa-id="git-branch-create"
									value={CREATE_BRANCH_VALUE}
									onSelect={() => {
										// Capture the search before `closePopover` clears it —
										// it seeds the dialog's name field.
										setCreateName(trimmedSearch);
										closePopover();
										setCreateOpen(true);
									}}
								>
									<PlusIcon />
									Create branch
								</CommandItem>
							</CommandGroup>
						</Command>
					)}
				</PopoverContent>
			</Popover>
			{createOpen ? (
				<CreateBranchDialog
					initialName={createName}
					isPending={checkout.isPending}
					defaultBranch={data?.defaultBranch}
					currentBranch={data?.currentBranch}
					onCancel={() => {
						setCreateOpen(false);
					}}
					onCreate={(name, startPoint) => {
						runCheckout(name, true, startPoint, () => {
							setCreateOpen(false);
						});
					}}
				/>
			) : null}
		</>
	);
}
