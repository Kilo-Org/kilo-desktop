import {
	ChevronDownIcon,
	CloudUploadIcon,
	FilesIcon,
	GitCommitIcon,
	GitPullRequestCreateIcon,
	LoaderCircleIcon,
	type LucideIcon,
} from "lucide-react";
import { Fragment, useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { ButtonGroup } from "@kilo-desktop/ui/components/button-group";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { toast } from "@kilo-desktop/ui/components/sonner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";

import type { RepositoryActionKind } from "./repository-actions.js";
import { useRepositoryActions } from "./use-repository-actions.js";

export interface GitActionsControlProps {
	readonly workspaceDirectory?: string;
	readonly onOpenChanges?: () => void;
}

const ACTION_ICONS: Record<
	RepositoryActionKind | "commit" | "push" | "view-pr" | "create-pr",
	LucideIcon
> = {
	disabled: GitCommitIcon,
	commit: GitCommitIcon,
	"commit-push": CloudUploadIcon,
	"commit-push-pr": GitPullRequestCreateIcon,
	pull: CloudUploadIcon,
	"view-pr": GitPullRequestCreateIcon,
	push: CloudUploadIcon,
	"create-pr": GitPullRequestCreateIcon,
};

export function GitActionsControl({ workspaceDirectory, onOpenChanges }: GitActionsControlProps) {
	if (!workspaceDirectory) return null;
	return (
		<GitActions
			workspaceDirectory={workspaceDirectory}
			{...(onOpenChanges ? { onOpenChanges } : {})}
		/>
	);
}

function GitActions({
	workspaceDirectory,
	onOpenChanges,
}: {
	readonly workspaceDirectory: string;
	readonly onOpenChanges?: () => void;
}) {
	const actions = useRepositoryActions(workspaceDirectory);
	const [defaultBranchConfirmation, setDefaultBranchConfirmation] = useState<{
		label: string;
		branch: string;
		action: "push" | "quick";
	} | null>(null);
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
		<div className="border-border mr-0.5 flex items-center gap-1 border-r pr-1.5">
			{actions.stats && actions.hasChanges ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="gap-2 rounded-md px-2"
					disabled={!onOpenChanges}
					onClick={onOpenChanges}
					aria-label={`${actions.stats.additions} additions, ${actions.stats.deletions} deletions, ${actions.filesChanged} files changed. Open Changes.`}
					data-qa-id="git-open-changes-summary"
				>
					<FilesIcon />
					<span className="text-muted-foreground">{actions.filesChanged}</span>
					<span className="text-emerald-600 dark:text-emerald-300">+{actions.stats.additions}</span>
					<span className="text-red-600 dark:text-red-300">-{actions.stats.deletions}</span>
				</Button>
			) : null}
			<ButtonGroup
				aria-label="Repository actions"
				className="[&>[data-slot]:first-child]:rounded-l-md! [&>[data-slot]:last-child]:rounded-r-md!"
			>
				<Button
					type="button"
					variant="outline"
					size="sm"
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
				<DropdownMenu
					onOpenChange={(open) => {
						if (open) actions.refreshMenu();
					}}
				>
					<DropdownMenuTrigger
						render={
							<Button
								type="button"
								variant="outline"
								size="icon-sm"
								aria-label="Repository action options"
							/>
						}
						disabled={actions.busy}
					>
						<ChevronDownIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-44">
						{actions.menu.map((action, index) => {
							const Icon = ACTION_ICONS[action.id];
							return (
								<Fragment key={action.id}>
									{index === 2 ? <DropdownMenuSeparator /> : null}
									<DropdownMenuItem
										disabled={action.disabledReason !== null}
										title={action.disabledReason ?? undefined}
										onClick={() => {
											if (
												action.id === "push" &&
												actions.isDefaultBranch &&
												actions.currentBranch
											) {
												setDefaultBranchConfirmation({
													label: "Push",
													branch: actions.currentBranch,
													action: "push",
												});
												return;
											}
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
