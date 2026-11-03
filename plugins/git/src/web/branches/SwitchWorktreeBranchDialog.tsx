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

export interface SwitchWorktreeBranchDialogProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	/** Confirmed action: run the checkout that was held pending. */
	readonly onConfirm: () => void;
	/** Directory name of the worktree whose branch would change. */
	readonly worktreeName: string;
	/** Branch being switched to. */
	readonly branch: string;
	/** Number of sessions (any status) whose directory is this worktree. */
	readonly sessionCount: number;
}

/**
 * Confirmation shown before switching the branch of an existing worktree
 * that one or more sessions already use: the worktree's branch is shared
 * state across those sessions, so changing it under them needs an
 * explicit choice. Only reached from `GitBranchSelector` when the picked
 * branch is not already checked out elsewhere (no silent retarget) and
 * the session-directories store reports at least one user of the target
 * worktree.
 */
export function SwitchWorktreeBranchDialog({
	open,
	onOpenChange,
	onConfirm,
	worktreeName,
	branch,
	sessionCount,
}: SwitchWorktreeBranchDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent data-qa-id="git-branch-switch-confirm">
				<AlertDialogHeader>
					<AlertDialogTitle>Switch branch in this worktree?</AlertDialogTitle>
					<AlertDialogDescription>
						<span className="font-medium">{worktreeName}</span> is used by {sessionCount} session
						{sessionCount === 1 ? "" : "s"}. Switching to{" "}
						<span className="font-medium">{branch}</span> changes the branch under them.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel data-qa-id="git-branch-switch-confirm-cancel">
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction data-qa-id="git-branch-switch-confirm-accept" onClick={onConfirm}>
						Switch anyway
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
