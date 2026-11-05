import { ArchiveIcon, ArchiveRestoreIcon, PinIcon, PinOffIcon, Trash2Icon } from "lucide-react";
import { useState, type FC, type ReactNode } from "react";

import type { DomainHandle } from "@kilo-desktop/kernel";
import type { Session, Sessions } from "@kilo-desktop/plugin-sessions/contracts";
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
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { worktreesOrphanedBy } from "./session-list-selection";

/*
 * Bulk actions for the session list's multi-selection: the right-click menu
 * and the delete confirm. kilo.sessions has no batch methods, so each action
 * runs the single-session method per session, in turn, and reports the batch
 * in one toast. Archive is undoable (Restore), so it acts without a confirm.
 * Delete confirms once; when the batch orphans worktrees it offers to remove
 * them, and `remove({ removeWorktree })` drops a worktree only once no other
 * session shares it, so a session that fails to delete keeps its worktree.
 */

export type SessionBulkTarget = {
	readonly session: Session;
	/** Busy sessions can't be archived, as their row hides the archive button. */
	readonly canArchive: boolean;
};

const sessionsLabel = (count: number) => (count === 1 ? "1 session" : `${count} sessions`);
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Unknown error");

/** Runs `act` on each item in turn; one failure does not stop the batch. */
async function runEach<T, R>(items: readonly T[], act: (item: T) => Promise<R>) {
	const results: R[] = [];
	const failed: unknown[] = [];
	for (const item of items) {
		try {
			results.push(await act(item));
		} catch (error) {
			failed.push(error);
		}
	}
	return { results, failed };
}

type Verb = readonly [done: string, failed: string];

function reportBatch(
	[doneVerb, failVerb]: Verb,
	done: number,
	failed: unknown[],
	description?: string,
) {
	if (done > 0) toast.success(`${doneVerb} ${sessionsLabel(done)}`, { description });
	if (failed.length > 0) {
		toast.error(`Could not ${failVerb} ${sessionsLabel(failed.length)}`, {
			description: errorText(failed[0]),
		});
	}
}

export function SessionBulkMenuItems({
	targets,
	sessions,
	onDone,
	onDelete,
}: {
	targets: readonly SessionBulkTarget[];
	sessions: DomainHandle<typeof Sessions> | null;
	onDone: () => void;
	onDelete: () => void;
}): ReactNode {
	const active = targets.filter((target) => !target.session.archived);
	const archivable = active.filter((target) => target.canArchive);
	const archived = targets.filter((target) => target.session.archived);
	const unpinned = active.filter((target) => !target.session.pinned);
	const pinTargets = unpinned.length > 0 ? unpinned : active;
	const pin = unpinned.length > 0;

	const run = (
		verb: Verb,
		items: readonly SessionBulkTarget[],
		act: (id: string) => Promise<unknown>,
	) => {
		onDone();
		void runEach(items, (target) => act(target.session.id)).then(({ results, failed }) => {
			const skipped = verb[0] === "Archived" ? active.length - archivable.length : 0;
			reportBatch(
				verb,
				results.length,
				failed,
				skipped > 0 ? `Skipped ${sessionsLabel(skipped)} that can't be archived yet.` : undefined,
			);
		});
	};

	return (
		<>
			<DropdownMenuGroup>
				<DropdownMenuLabel>{sessionsLabel(targets.length)} selected</DropdownMenuLabel>
				{pinTargets.length > 0 ? (
					<DropdownMenuItem
						data-qa-id="session-bulk-pin"
						onClick={() =>
							run(pin ? ["Pinned", "pin"] : ["Unpinned", "unpin"], pinTargets, async (id) =>
								sessions?.methods.setPinned({ id, pinned: pin }),
							)
						}
					>
						{pin ? <PinIcon /> : <PinOffIcon />}
						{pin ? "Pin" : "Unpin"} {sessionsLabel(pinTargets.length)}
					</DropdownMenuItem>
				) : null}
				{archivable.length > 0 ? (
					<DropdownMenuItem
						data-qa-id="session-bulk-archive"
						onClick={() =>
							run(["Archived", "archive"], archivable, async (id) =>
								sessions?.methods.setArchived({ id, archived: true }),
							)
						}
					>
						<ArchiveIcon />
						Archive {sessionsLabel(archivable.length)}
					</DropdownMenuItem>
				) : null}
				{archived.length > 0 ? (
					<DropdownMenuItem
						data-qa-id="session-bulk-restore"
						onClick={() =>
							run(["Restored", "restore"], archived, async (id) =>
								sessions?.methods.setArchived({ id, archived: false }),
							)
						}
					>
						<ArchiveRestoreIcon />
						Restore {sessionsLabel(archived.length)}
					</DropdownMenuItem>
				) : null}
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			<DropdownMenuItem variant="destructive" data-qa-id="session-bulk-delete" onClick={onDelete}>
				<Trash2Icon />
				Delete {sessionsLabel(targets.length)}…
			</DropdownMenuItem>
		</>
	);
}

/** The one confirm for deleting a selection; open while `targets` is set. */
export const SessionBulkDeleteDialog: FC<{
	targets: readonly Session[] | null;
	sessions: DomainHandle<typeof Sessions> | null;
	onClose: () => void;
}> = ({ targets, sessions, onClose }) => {
	const [snapshot, setSnapshot] = useState<readonly Session[]>([]);
	if (targets && targets !== snapshot) setSnapshot(targets);
	const shown = targets ?? snapshot;
	const worktrees = worktreesOrphanedBy(
		sessions?.getState().sessions ?? [],
		new Set(shown.map((session) => session.id)),
	);
	const remove = (removeWorktree: boolean) => {
		onClose();
		void runEach(shown, (session) =>
			sessions!.methods.remove({ id: session.id, removeWorktree }),
		).then(({ results, failed }) => {
			reportBatch(["Deleted", "delete"], results.length, failed);
			const worktreeError = results.find((result) => result.worktreeError)?.worktreeError;
			if (worktreeError !== undefined) {
				toast.error("Some worktrees were left in place", {
					description: worktreeError,
					duration: Infinity,
				});
			}
		});
	};

	return (
		<AlertDialog open={targets !== null} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent data-qa-id="session-bulk-delete-dialog" className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {sessionsLabel(shown.length)}?</AlertDialogTitle>
					<AlertDialogDescription>
						{worktrees.length > 0 ? (
							<>
								They are the last sessions using{" "}
								<span className="font-mono text-xs">{worktrees.join(", ")}</span>. Deleting the
								{worktrees.length === 1 ? " worktree loses its" : " worktrees loses their"}{" "}
								uncommitted changes and unpushed commits.
							</>
						) : (
							"This permanently deletes the sessions and their history. This cannot be undone."
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					{worktrees.length > 0 ? (
						<AlertDialogAction
							data-qa-id="session-bulk-delete-keep-worktrees"
							onClick={() => remove(false)}
						>
							Keep {worktrees.length === 1 ? "worktree" : "worktrees"}
						</AlertDialogAction>
					) : null}
					<AlertDialogAction
						variant="destructive"
						data-qa-id="session-bulk-delete-confirm"
						onClick={() => remove(worktrees.length > 0)}
					>
						{worktrees.length > 0 ? "Delete all" : `Delete ${sessionsLabel(shown.length)}`}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};
