import {
	ChevronDownIcon,
	CloudUploadIcon,
	FilesIcon,
	GitCommitHorizontalIcon,
	GitPullRequestCreateIcon,
	LoaderCircleIcon,
	MessageSquareIcon,
	type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ComponentType } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Composer } from "@kilo-desktop/plugin-chat/contracts";
import {
	WorkSessionsWindow,
	type WorkSessionActionProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { Button } from "@kilo-desktop/ui/components/button";
import { ButtonGroup, ButtonGroupSeparator } from "@kilo-desktop/ui/components/button-group";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { ScrollArea } from "@kilo-desktop/ui/components/scroll-area";
import { toast } from "@kilo-desktop/ui/components/sonner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { CHANGES_PANE_KIND } from "../../contracts";
import { useWorkSessionDirectory } from "../pull-requests/use-pull-request";
import type { RepositoryActionKind } from "./repository-actions";
import type { ActionProgress, ActionRequests, RequestedAction } from "./action-progress";
import { useRepositoryActions, type RepositoryActions } from "./use-repository-actions";

// Split button halves: at rest the pair reads as one ghost control; hovering
// either half (or opening the menu) lights the whole pill, reveals the seam and
// steps the half under the pointer up, so the seam never reads as a divider.
const SPLIT_HALF_CLASS_NAME =
	"hover:bg-(color:--state-selected) group-hover/split:bg-(color:--state-hover) group-has-[[aria-expanded=true]]/split:bg-(color:--state-hover)";

// The app-wide TooltipProvider opens instantly; the app bar is crossed often,
// so this hint waits for a deliberate hover.
const OPEN_CHANGES_TOOLTIP_DELAY_MS = 500;

const ACTION_ICONS: Record<
	RepositoryActionKind | "commit" | "push" | "view-pr" | "create-pr",
	LucideIcon
> = {
	disabled: GitCommitHorizontalIcon,
	commit: GitCommitHorizontalIcon,
	"commit-push": CloudUploadIcon,
	"commit-push-pr": GitPullRequestCreateIcon,
	pull: CloudUploadIcon,
	"view-pr": GitPullRequestCreateIcon,
	push: CloudUploadIcon,
	"create-pr": GitPullRequestCreateIcon,
};

/**
 * The open work session's repository actions
 * (`kilo.work-sessions/work-session-action`, placed before the pane controls
 * as origin's header had them): the changed files summary, the commit / push
 * / pull request split button and its menu, for the work session's directory.
 * Commands' requests are run as if picked from the menu.
 */
export function createGitSessionActions(window: {
	readonly progress: ActionProgress;
	readonly requests: ActionRequests;
}): ComponentType<WorkSessionActionProps> {
	function GitSessionActions({ workSession }: WorkSessionActionProps) {
		const directory = useWorkSessionDirectory(workSession);
		const workSessionsWindow = useDomainObject(WorkSessionsWindow);
		const composer = useDomainObject(Composer);
		if (!directory) return null;
		return (
			<GitActions
				key={directory}
				workspaceDirectory={directory}
				progress={window.progress}
				requests={window.requests}
				onOpenChanges={() =>
					void workSessionsWindow?.methods
						.openPane({ kind: CHANGES_PANE_KIND, placement: "group" })
						.catch(() => undefined)
				}
				{...(composer
					? {
							onAppendToChat: (text: string) =>
								void composer.methods
									.insert({ workSessionId: workSession.id, text })
									.catch((error: unknown) =>
										toast.error("Could not add the error to the chat", {
											description: error instanceof Error ? error.message : undefined,
										}),
									),
						}
					: {})}
			/>
		);
	}
	return GitSessionActions;
}

/** Runs a command's request like the matching menu item, saying why when it can't. */
function useRequestedActions(
	requests: ActionRequests,
	actions: RepositoryActions | null,
	confirmDefaultBranchPush: () => boolean,
) {
	const latest = useRef({ actions, confirmDefaultBranchPush });
	latest.current = { actions, confirmDefaultBranchPush };
	useEffect(
		() =>
			requests.listen((requested: RequestedAction) => {
				const current = latest.current.actions;
				if (!current) {
					toast.error("No repository actions here", {
						description: "This session's folder is not a git repository.",
					});
					return;
				}
				const id =
					requested === "create-pr" && !current.menu.some((action) => action.id === "create-pr")
						? "view-pr"
						: requested;
				const action = current.menu.find((candidate) => candidate.id === id);
				if (!action) return;
				if (action.disabledReason !== null) {
					toast.error(`${action.label} isn't available`, {
						description: action.disabledReason,
					});
					return;
				}
				if (action.id === "push" && latest.current.confirmDefaultBranchPush()) return;
				action.run();
			}),
		[requests],
	);
}

function GitActions({
	workspaceDirectory,
	progress,
	requests,
	onOpenChanges,
	onAppendToChat,
}: {
	readonly workspaceDirectory: string;
	readonly progress: ActionProgress;
	readonly requests: ActionRequests;
	readonly onOpenChanges?: () => void;
	readonly onAppendToChat?: (text: string) => void;
}) {
	const actions = useRepositoryActions(workspaceDirectory, progress);
	const [defaultBranchConfirmation, setDefaultBranchConfirmation] = useState<{
		label: string;
		branch: string;
		action: "push" | "quick";
	} | null>(null);
	/** Asks before pushing to the default branch; true when it asked. */
	const confirmDefaultBranchPush = () => {
		if (!actions?.isDefaultBranch || !actions.currentBranch) return false;
		setDefaultBranchConfirmation({ label: "Push", branch: actions.currentBranch, action: "push" });
		return true;
	};
	useRequestedActions(requests, actions, confirmDefaultBranchPush);
	if (!actions) return null;

	const PrimaryIcon = ACTION_ICONS[actions.quickAction.kind];
	const showPrimaryPullRequest =
		actions.quickAction.kind === "view-pr" && actions.pullRequest !== null;
	const pullRequestClassName = actions.menu.find((action) => action.id === "view-pr")?.className;
	const runQuickAction = () => {
		if (actions.confirmQuickAction && actions.currentBranch) {
			setDefaultBranchConfirmation({
				label: actions.quickAction.label,
				branch: actions.currentBranch,
				action: "quick",
			});
			return;
		}
		actions.runQuickAction();
	};

	return (
		<div className="mr-0.5 flex items-center gap-1 border-r-[0.5px] border-(--pane-hairline) pr-1.5">
			{actions.stats && actions.hasChanges ? (
				<Tooltip>
					<TooltipTrigger
						delay={OPEN_CHANGES_TOOLTIP_DELAY_MS}
						render={
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="gap-2 rounded-md px-2"
								disabled={!onOpenChanges}
								onClick={onOpenChanges}
								aria-label={`${actions.stats.additions} additions, ${actions.stats.deletions} deletions, ${actions.filesChanged} files changed. Open Changes.`}
								data-qa-id="git-open-changes-summary"
							/>
						}
					>
						<FilesIcon />
						<span className="text-muted-foreground">{actions.filesChanged}</span>
						<span className="text-success">+{actions.stats.additions}</span>
						<span className="text-destructive">-{actions.stats.deletions}</span>
					</TooltipTrigger>
					<TooltipContent side="bottom">Approximate changes since the last commit.</TooltipContent>
				</Tooltip>
			) : null}
			<ButtonGroup
				aria-label="Repository actions"
				className="group/split [&>[data-slot]:first-child]:rounded-l-md! [&>[data-slot]:last-child]:rounded-r-md!"
			>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={SPLIT_HALF_CLASS_NAME}
					disabled={actions.busy || actions.quickAction.disabledReason !== null}
					title={actions.quickAction.disabledReason ?? undefined}
					aria-label={
						showPrimaryPullRequest && actions.pullRequest
							? `PR #${actions.pullRequest.number}: ${actions.pullRequest.title}`
							: undefined
					}
					onClick={runQuickAction}
					data-qa-id="git-action-primary"
				>
					{actions.busy ? (
						<LoaderCircleIcon className="animate-spin" />
					) : (
						<PrimaryIcon className={showPrimaryPullRequest ? pullRequestClassName : undefined} />
					)}
					<span
						className={`hidden xl:inline ${!actions.progressLabel && showPrimaryPullRequest && pullRequestClassName ? pullRequestClassName : ""}`}
						title={
							showPrimaryPullRequest && actions.pullRequest ? actions.pullRequest.title : undefined
						}
					>
						{actions.progressLabel ??
							(showPrimaryPullRequest && actions.pullRequest
								? `PR #${actions.pullRequest.number}`
								: actions.quickAction.label)}
					</span>
				</Button>
				<ButtonGroupSeparator className="bg-(color:--pane-hairline) opacity-0 transition-opacity group-hover/split:opacity-100 group-has-[[aria-expanded=true]]/split:opacity-100 data-vertical:my-1.5 data-vertical:w-[0.5px]" />
				<DropdownMenu
					onOpenChange={(open) => {
						if (open) actions.refreshMenu();
					}}
				>
					<DropdownMenuTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className={`${SPLIT_HALF_CLASS_NAME} aria-expanded:bg-(color:--state-selected)`}
								aria-label="Repository action options"
							/>
						}
						disabled={actions.busy}
					>
						<ChevronDownIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{actions.menu.map((action, index) => {
							const Icon = ACTION_ICONS[action.id];
							return (
								<Fragment key={action.id}>
									{index === 2 ? <DropdownMenuSeparator /> : null}
									<DropdownMenuItem
										disabled={action.disabledReason !== null}
										title={action.disabledReason ?? undefined}
										onClick={() => {
											if (action.id === "push" && confirmDefaultBranchPush()) return;
											action.run();
										}}
										data-qa-id={`git-action-${action.id}`}
									>
										<Icon className={action.className} />
										<span className={action.className}>{action.label}</span>
									</DropdownMenuItem>
								</Fragment>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			</ButtonGroup>
			<Dialog
				open={actions.pushError !== null}
				onOpenChange={(open) => {
					if (!open) {
						actions.dismissPushError();
					}
				}}
			>
				<DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
					<DialogHeader className="min-w-0 pr-6">
						<DialogTitle>Unable to push</DialogTitle>
						<DialogDescription>
							Git could not complete the push. Review the details below before trying again.
						</DialogDescription>
					</DialogHeader>
					<ScrollArea className="h-[min(20rem,50dvh)] max-h-full min-h-0 min-w-0 rounded-md border">
						<pre className="p-3 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
							{actions.pushError}
						</pre>
					</ScrollArea>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />} data-qa-id="git-push-error-close">
							Close
						</DialogClose>
						{onAppendToChat ? (
							<Button
								data-qa-id="git-push-error-fix-in-chat"
								title="Add the error to your current chat draft without sending it"
								onClick={() => {
									const error = actions.pushError;
									if (error === null) return;
									onAppendToChat(
										`Git error output:\n${error}\n\nHelp me diagnose and fix the Git push failure above in ${workspaceDirectory}.`,
									);
									actions.dismissPushError();
								}}
							>
								<MessageSquareIcon data-icon="inline-start" />
								Fix in chat
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog
				open={defaultBranchConfirmation !== null}
				onOpenChange={(open) => {
					if (!open) setDefaultBranchConfirmation(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{defaultBranchConfirmation?.label === "Commit & push"
								? "Commit & push to default branch?"
								: "Push to default branch?"}
						</DialogTitle>
						<DialogDescription>
							This action will{" "}
							{defaultBranchConfirmation?.label === "Commit & push"
								? "commit and push changes"
								: "push local commits"}{" "}
							on
							{` "${defaultBranchConfirmation?.branch}"`}. You can continue on this branch or create
							a feature branch and run the same action there.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDefaultBranchConfirmation(null)}>
							Cancel
						</Button>
						<Button
							onClick={() => {
								const confirmed = defaultBranchConfirmation;
								setDefaultBranchConfirmation(null);
								if (!confirmed) return;
								if (actions.currentBranch !== confirmed.branch) {
									toast.error("Repository branch changed", {
										description: "Review the repository action again before continuing.",
									});
									return;
								}
								if (confirmed.action === "push") actions.push();
								else actions.runQuickAction();
							}}
						>
							{defaultBranchConfirmation?.label}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
