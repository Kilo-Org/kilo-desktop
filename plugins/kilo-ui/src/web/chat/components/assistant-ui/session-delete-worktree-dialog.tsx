"use client";

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
	/** Branch the orphaned worktree was created for; shown in the warning copy. */
	readonly worktreeBranch: string | undefined;
	/** Delete only the session, keeping the worktree on disk. */
	readonly onKeepWorktree: () => void;
	/** Delete the session and then remove the worktree. */
	readonly onDeleteWorktree: () => void;
}

/**
 * Confirmation shown when deleting a session that is the last known user of
 * a worktree: the destructive option removes the worktree (and its unpushed
 * commits) from disk, so it needs an explicit choice. The `sm:max-w-md`
 * override keeps the three-button footer on one row.
 */
export function SessionDeleteWorktreeDialog({
	open,
	onOpenChange,
	worktreeBranch,
	onKeepWorktree,
	onDeleteWorktree,
}: SessionDeleteWorktreeDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent data-qa-id="session-delete-worktree-dialog" className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Delete session and worktree?</AlertDialogTitle>
					<AlertDialogDescription>
						This deletes the session and the worktree for branch{" "}
						<span className="font-medium">{worktreeBranch}</span>. Uncommitted changes and unpushed
						commits in the worktree will be lost.
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
