"use client";

import { GitBranchIcon, MessageSquareIcon } from "lucide-react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kilo-desktop/ui/components/alert-dialog";

export interface SessionDeleteWorktreeDialogProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	/** Title of the session being deleted; its line is omitted when empty. */
	readonly sessionTitle: string | undefined;
	/** Branch the orphaned worktree was created for; shown in the warning copy. */
	readonly worktreeBranch: string | undefined;
	/** Delete only the session, keeping the worktree on disk. */
	readonly onKeepWorktree: () => void;
	/** Delete the session and then remove the worktree. */
	readonly onDeleteWorktree: () => void;
}

/**
 * Confirmation shown when deleting a session that is the last known user of
 * a worktree, listing the session and the worktree it would remove: the destructive option removes the worktree (and its unpushed
 * commits) from disk, so it needs an explicit choice. The `sm:max-w-md`
 * override keeps the three-button footer on one row.
 */
export function SessionDeleteWorktreeDialog({
	open,
	onOpenChange,
	sessionTitle,
	worktreeBranch,
	onKeepWorktree,
	onDeleteWorktree,
}: SessionDeleteWorktreeDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent data-qa-id="session-delete-worktree-dialog" className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Delete session and worktree?</AlertDialogTitle>
					<div
						data-qa-id="session-delete-worktree-items"
						className="bg-foreground/6 ring-foreground/6 divide-foreground/6 my-1 w-full divide-y rounded-lg ring-1 ring-inset"
					>
						{sessionTitle ? (
							<div className="flex h-9 min-w-0 items-center gap-2 px-2.5">
								<MessageSquareIcon
									aria-hidden
									className="text-muted-foreground size-3.5 shrink-0"
								/>
								<span className="truncate text-sm font-medium">{sessionTitle}</span>
							</div>
						) : null}
						<div className="flex h-9 min-w-0 items-center gap-2 px-2.5">
							<GitBranchIcon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
							<span className="min-w-0 flex-1 truncate font-mono text-xs">{worktreeBranch}</span>
							<span className="text-muted-foreground shrink-0 text-xs">Worktree</span>
						</div>
					</div>
					<AlertDialogDescription>
						Deleting the worktree loses its uncommitted changes and unpushed commits. Keep it to
						delete only the session.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel data-qa-id="session-delete-worktree-cancel">Cancel</AlertDialogCancel>
					<AlertDialogAction data-qa-id="session-delete-keep-worktree" onClick={onKeepWorktree}>
						Keep worktree
					</AlertDialogAction>
					<AlertDialogAction
						variant="destructive"
						data-qa-id="session-delete-worktree-confirm"
						onClick={onDeleteWorktree}
					>
						Delete both
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
