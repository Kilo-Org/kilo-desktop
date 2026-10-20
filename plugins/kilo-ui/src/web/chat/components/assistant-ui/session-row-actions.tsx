import { useAui, useAuiState } from "@assistant-ui/react";
import {
	ArchiveIcon,
	EllipsisIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	SquareKanbanIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ComponentProps,
	type FC,
	type RefObject,
} from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Input } from "@kilo-desktop/ui/components/input";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type { KiloUiChatService } from "../../../../contracts/chat/schemas.js";
import {
	useSessionActivity,
	useSessionActivityStore,
} from "../../session-activity/SessionActivityProvider.js";
import {
	isOrphanedWorktreeSession,
	type SessionActivity,
} from "../../session-activity/session-activity-logic.js";
import { whenSessionsRefreshed } from "../../session-activity/session-activity-store.js";
import type { SessionRowBoard } from "../../workspace-board/use-session-row-board.js";
import { SessionDeleteWorktreeDialog } from "./session-delete-worktree-dialog.js";

/*
 * Chat actions shared by every surface that lists chats (the sidebar rows and
 * the workspace board cards): the archive and worktree-aware delete flow, the
 * actions menu, and inline rename. The row actions and inline rename act on
 * assistant-ui's thread-list-item scope, so callers outside the thread list
 * provide one (ThreadListItemByIndexProvider), or pass operations of their own
 * (the popped-out board, whose chats live in the main window's thread list).
 */

export function useRenameState(): {
	isRenaming: boolean;
	startRename: () => void;
	finishRename: (restoreFocus: boolean) => void;
	triggerRef: RefObject<HTMLButtonElement | null>;
} {
	const [isRenaming, setIsRenaming] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const restoreFocusRef = useRef(false);

	useEffect(() => {
		if (isRenaming || !restoreFocusRef.current) return;
		restoreFocusRef.current = false;
		triggerRef.current?.focus();
	}, [isRenaming]);
	const startRename = useCallback(() => setIsRenaming(true), []);
	const finishRename = useCallback((restoreFocus: boolean) => {
		restoreFocusRef.current = restoreFocus;
		setIsRenaming(false);
	}, []);

	return { isRenaming, startRename, finishRename, triggerRef };
}

type SessionRowWorktreeDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	worktreeBranch: string | undefined;
	onKeepWorktree: () => void;
	onDeleteWorktree: () => void;
};

/** How a surface archives and deletes a chat, when not through the thread-list-item scope. */
export type SessionRowOperations = {
	archive: () => Promise<void>;
	delete: () => Promise<void>;
	/**
	 * Whether deleting should offer to remove the chat's worktree, for a surface
	 * whose own activity store cannot tell (it settles the store's refresh itself).
	 */
	checkOrphanedWorktree?: () => Promise<boolean>;
};

// The scope's methods are typed void but return the thread list's promises.
const threadListItemOperations = (aui: ReturnType<typeof useAui>): SessionRowOperations => ({
	archive: async () => aui.threadListItem.archive(),
	delete: async () => aui.threadListItem.delete(),
});

/**
 * Archive and delete for the chat, including the orphaned-worktree confirm.
 * They act on the thread-list-item scope unless `operations` says otherwise.
 */
export function useSessionRowActions({
	remoteId,
	activity,
	onDeleted,
	operations,
}: {
	remoteId: string | undefined;
	activity: SessionActivity | undefined;
	/** Runs after the chat is deleted (e.g. to take it off the board). */
	onDeleted?: (() => void) | undefined;
	operations?: SessionRowOperations | undefined;
}): {
	archive: () => void;
	deleteThread: () => void;
	/** Present only for an orphaned worktree chat, which confirms before deleting. */
	worktreeDialog: SessionRowWorktreeDialogProps | null;
} {
	const aui = useAui();
	const operationsRef = useRef<SessionRowOperations>(threadListItemOperations(aui));
	operationsRef.current = operations ?? threadListItemOperations(aui);
	const sdk = useSdk<KiloUiChatService>("kilo-ui");
	// Orphan check (t3code): the delete dialog only offers worktree removal
	// when no other known session shares the directory. The selector closes
	// over `remoteId`, which is safe — `useStore` re-runs it on every render —
	// and returns a primitive so the row only re-renders when the flag flips.
	const isLocallyOrphanedWorktree = useSessionActivity(
		(s) => remoteId !== undefined && isOrphanedWorktreeSession(s.sessions, remoteId),
	);
	const [isCheckedOrphanedWorktree, setCheckedOrphanedWorktree] = useState(false);
	const isOrphanedWorktree = operations?.checkOrphanedWorktree
		? isCheckedOrphanedWorktree
		: isLocallyOrphanedWorktree;
	const activityStore = useSessionActivityStore();
	const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
	const worktreeDirectory = activity?.worktreeBranch !== undefined ? activity.directory : undefined;

	const archive = useCallback(() => {
		operationsRef.current.archive().catch((error: unknown) => {
			toast.error("Could not archive session", {
				description: error instanceof Error ? error.message : "The session was not archived.",
			});
		});
	}, []);
	// Every delete path funnels through here so a rejecting delete is
	// reported, never an unhandled rejection.
	const deleteSession = useCallback(async (): Promise<boolean> => {
		try {
			await operationsRef.current.delete();
			onDeleted?.();
			return true;
		} catch (error) {
			toast.error("Could not delete session", {
				description: error instanceof Error ? error.message : "The session was not deleted.",
			});
			return false;
		}
	}, [onDeleted]);
	// A session with no hydrated record may be mid-refresh, not local: wait
	// for the refresh to settle (bounded), re-evaluate, then delete — a
	// worktree session must never leak behind a premature direct delete.
	const deleteAfterRefresh = useCallback(async () => {
		if (remoteId === undefined) return;
		await whenSessionsRefreshed(activityStore);
		if (isOrphanedWorktreeSession(activityStore.getState().sessions, remoteId)) {
			setWorktreeDialogOpen(true);
			return;
		}
		await deleteSession();
	}, [activityStore, remoteId, deleteSession]);
	const deleteAfterCheck = useCallback(
		async (checkOrphanedWorktree: () => Promise<boolean>) => {
			let orphaned: boolean;
			try {
				orphaned = await checkOrphanedWorktree();
			} catch (error) {
				toast.error("Could not delete session", {
					description: error instanceof Error ? error.message : "The session was not deleted.",
				});
				return;
			}
			if (!orphaned) {
				await deleteSession();
				return;
			}
			setCheckedOrphanedWorktree(true);
			setWorktreeDialogOpen(true);
		},
		[deleteSession],
	);
	const deleteThread = useCallback(() => {
		// Worktree-backed and orphaned: confirm before removing the worktree.
		if (isOrphanedWorktree) {
			setWorktreeDialogOpen(true);
			return;
		}
		const checkOrphanedWorktree = operationsRef.current.checkOrphanedWorktree;
		if (checkOrphanedWorktree) {
			void deleteAfterCheck(checkOrphanedWorktree);
			return;
		}
		// The refresh has not settled: the record may be missing entirely or
		// present without its worktree stamp (e.g. only `directory` was
		// hydrated so far). Wait for the refresh to complete so the orphan
		// check runs against the full picture — a premature direct delete
		// would silently leak the worktree.
		if (remoteId !== undefined && !activityStore.getState().sessionsRefreshed) {
			void deleteAfterRefresh();
			return;
		}
		void deleteSession();
	}, [
		isOrphanedWorktree,
		activityStore,
		remoteId,
		deleteAfterCheck,
		deleteAfterRefresh,
		deleteSession,
	]);
	const keepWorktreeAndDelete = useCallback(() => {
		setWorktreeDialogOpen(false);
		void deleteSession();
	}, [deleteSession]);
	const deleteThreadAndWorktree = useCallback(async () => {
		setWorktreeDialogOpen(false);
		const deleted = await deleteSession();
		// Removal only runs after the session delete resolves; a failed delete
		// returns early — the surviving session may still reference the
		// worktree. Otherwise failure keeps the worktree on disk and only
		// reports — the session is already gone.
		if (!deleted) return;
		const directory = worktreeDirectory;
		if (directory === undefined) return;
		const branch = activity?.worktreeBranch;
		toast.promise(sdk.client["chat.removeWorktree"]({ directory }), {
			loading: "Removing worktree…",
			success: () => ({
				message: "Worktree deleted",
				description: branch ? `Branch ${branch} and its worktree were removed.` : undefined,
			}),
			error: (error: unknown) => ({
				message: "Could not remove worktree",
				description: error instanceof Error ? error.message : "The worktree was left in place.",
				duration: Infinity,
			}),
		});
	}, [sdk, deleteSession, worktreeDirectory, activity?.worktreeBranch]);

	const worktreeDialog =
		isOrphanedWorktree && worktreeDirectory !== undefined
			? {
					open: worktreeDialogOpen,
					onOpenChange: (open: boolean) => {
						if (!open) setWorktreeDialogOpen(false);
					},
					worktreeBranch: activity?.worktreeBranch,
					onKeepWorktree: keepWorktreeAndDelete,
					onDeleteWorktree: () => {
						void deleteThreadAndWorktree();
					},
				}
			: null;

	return { archive, deleteThread, worktreeDialog };
}

export const SessionRowWorktreeDialog: FC<{ dialog: SessionRowWorktreeDialogProps | null }> = ({
	dialog,
}) => (dialog ? <SessionDeleteWorktreeDialog {...dialog} /> : null);

/** The "…" button that opens an actions menu: ghost, extra small, with a "More" tooltip. */
export function MoreActionsTrigger({
	triggerRef,
	...buttonProps
}: {
	triggerRef?: RefObject<HTMLButtonElement | null> | undefined;
} & Omit<ComponentProps<typeof Button>, "children" | "ref">) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<DropdownMenuTrigger
						render={
							<Button
								ref={triggerRef}
								type="button"
								variant="ghost"
								size="icon-xs"
								{...buttonProps}
							/>
						}
					/>
				}
			>
				<EllipsisIcon />
			</TooltipTrigger>
			<TooltipContent side="bottom">More</TooltipContent>
		</Tooltip>
	);
}

export const SessionRowMenu: FC<{
	canArchive: boolean;
	canPin: boolean;
	pinned: boolean;
	onPin: () => void;
	onRename: () => void;
	onArchive: () => void;
	onDelete: () => void;
	board: SessionRowBoard | null;
	/** Lets inline rename return focus to the menu that started it. */
	triggerRef?: RefObject<HTMLButtonElement | null> | undefined;
	/** Names the chat when many menus share a surface (one per board card). */
	label?: string;
	side?: "right" | "bottom";
}> = ({
	canArchive,
	canPin,
	pinned,
	onPin,
	onRename,
	onArchive,
	onDelete,
	board,
	triggerRef,
	label = "Thread actions",
	side = "right",
}) => (
	<DropdownMenu>
		<MoreActionsTrigger
			triggerRef={triggerRef}
			data-slot="aui_session-list-item-more"
			aria-label={label}
		/>
		<DropdownMenuContent
			align="end"
			side={side}
			sideOffset={side === "right" ? 6 : 4}
			className="w-auto"
		>
			{canPin ? (
				<DropdownMenuItem onClick={onPin}>
					{pinned ? <PinOffIcon /> : <PinIcon />}
					{pinned ? "Unpin" : "Pin"}
				</DropdownMenuItem>
			) : null}
			{canArchive && (
				<DropdownMenuItem onClick={onArchive}>
					<ArchiveIcon />
					Archive
				</DropdownMenuItem>
			)}
			<DropdownMenuItem onClick={onRename}>
				<PencilIcon />
				Rename
			</DropdownMenuItem>
			{board ? (
				<>
					<DropdownMenuSeparator />
					<SessionRowBoardMenuItems board={board} />
				</>
			) : null}
			{/* Destructive last, set apart, as in the app's other menus. */}
			<DropdownMenuSeparator />
			<DropdownMenuItem variant="destructive" onClick={onDelete}>
				<Trash2Icon />
				Delete
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
);

const SessionRowBoardMenuItems: FC<{ board: SessionRowBoard }> = ({ board }) => (
	<>
		<DropdownMenuSub>
			<DropdownMenuSubTrigger data-qa-id="session-list-item-board-menu">
				<SquareKanbanIcon />
				{board.placement ? "Move on board" : "Add to board"}
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				{/* Radio items show the current column, as the list's view menu does for its options. */}
				<DropdownMenuRadioGroup
					value={board.placement?.columnId ?? ""}
					onValueChange={(columnId: string) => board.place(columnId)}
				>
					{board.columns.map((column) => (
						<DropdownMenuRadioItem
							key={column.id}
							value={column.id}
							closeOnClick
							data-qa-id={`session-list-item-board-${column.id}`}
						>
							{column.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
		{board.placement ? (
			<DropdownMenuItem data-qa-id="session-list-item-board-remove" onClick={board.remove}>
				<XIcon />
				Remove from board
			</DropdownMenuItem>
		) : null}
	</>
);

/** Inline rename for the chat in the thread-list-item scope. */
export const SessionItemRename: FC<{
	onDone: (restoreFocus: boolean) => void;
}> = ({ onDone }) => {
	const aui = useAui();
	const title = useAuiState((s) => s.threadListItem.title) ?? "";
	return (
		<SessionRenameInput
			title={title}
			onRename={async (next) => aui.threadListItem.rename(next)}
			onDone={onDone}
		/>
	);
};

/** Inline rename: commits on Enter or blur, says why and keeps editing when the rename fails. */
export const SessionRenameInput: FC<{
	title: string;
	onRename: (title: string) => Promise<void>;
	onDone: (restoreFocus: boolean) => void;
}> = ({ title, onRename, onDone }) => {
	const [value, setValue] = useState(title);
	const inputRef = useRef<HTMLInputElement>(null);
	const settledRef = useRef(false);

	useEffect(() => {
		inputRef.current?.select();
	}, []);

	const commit = (restoreFocus: boolean) => {
		if (settledRef.current) return;
		settledRef.current = true;

		const next = value.trim();
		if (!next || next === title) {
			onDone(restoreFocus);
			return;
		}

		// Deferred so a synchronous throw lands on the rejection path too.
		Promise.resolve()
			.then(() => onRename(next))
			.then(
				() => onDone(restoreFocus),
				(error: unknown) => {
					toast.error("Could not rename session", {
						description: error instanceof Error ? error.message : "The session was not renamed.",
					});
					settledRef.current = false;
					if (restoreFocus) inputRef.current?.focus();
				},
			);
	};

	const cancel = () => {
		if (settledRef.current) return;
		settledRef.current = true;
		onDone(true);
	};

	return (
		<Input
			ref={inputRef}
			autoFocus
			data-slot="aui_session-list-item-rename"
			aria-label="Rename thread"
			value={value}
			className="h-7 min-w-0 flex-1 px-1 text-sm"
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => commit(false)}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					commit(true);
				} else if (event.key === "Escape") {
					event.preventDefault();
					cancel();
				}
			}}
		/>
	);
};
