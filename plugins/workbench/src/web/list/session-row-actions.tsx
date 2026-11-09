import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	EllipsisIcon,
	GitBranchIcon,
	MessageSquareIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	Trash2Icon,
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

import type { Contribution } from "@kilo-desktop/kernel";
import { useExtensions } from "@kilo-desktop/kernel/web";
import { type WorkSession } from "@kilo-desktop/plugin-sessions/contracts";
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
import { SessionMenu, type SessionMenuItem } from "../../contracts";

/** Every session menu (⋯, right-click, bulk) shares this width; it grows for longer labels. */
export const SESSION_MENU_WIDTH_CLASS_NAME = "w-max min-w-44";

/*
 * What a session row offers: inline rename, its menu (pin, rename, plugins'
 * `kilo.workbench/session-menu` items, archive or restore, delete) and the
 * delete confirmation.
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

/** Reports a failed session action; the session is left as it was. */
export function reportFailure(message: string, fallback: string) {
	return (error: unknown) => {
		toast.error(message, {
			description: error instanceof Error ? error.message : fallback,
		});
	};
}

export const SessionDeleteConfirmDialog: FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	title: string;
}> = ({ open, onOpenChange, onConfirm, title }) => (
	<AlertDialog open={open} onOpenChange={onOpenChange}>
		<AlertDialogContent data-qa-id="session-delete-dialog">
			<AlertDialogHeader>
				<AlertDialogTitle>Delete this session?</AlertDialogTitle>
				<div
					data-qa-id="session-delete-chat-preview"
					className="bg-foreground/6 ring-foreground/6 my-1 flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 ring-1 ring-inset"
				>
					<MessageSquareIcon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
					<span className="truncate text-sm font-medium">{title}</span>
				</div>
				<AlertDialogDescription>
					This permanently deletes the session and its history. This cannot be undone.
				</AlertDialogDescription>
			</AlertDialogHeader>
			<AlertDialogFooter>
				<AlertDialogCancel data-qa-id="session-delete-cancel">Cancel</AlertDialogCancel>
				<AlertDialogAction
					variant="destructive"
					data-qa-id="session-delete-confirm"
					onClick={onConfirm}
				>
					Delete session
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
);

/**
 * Deleting the last session working in a worktree: origin's choice between
 * keeping the worktree on disk and deleting it with its uncommitted changes
 * and unpushed commits.
 */
export const SessionDeleteWorktreeDialog: FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	worktreeBranch: string | null;
	onKeepWorktree: () => void;
	onDeleteWorktree: () => void;
}> = ({ open, onOpenChange, title, worktreeBranch, onKeepWorktree, onDeleteWorktree }) => (
	<AlertDialog open={open} onOpenChange={onOpenChange}>
		<AlertDialogContent data-qa-id="session-delete-worktree-dialog" className="sm:max-w-md">
			<AlertDialogHeader>
				<AlertDialogTitle>Delete session and worktree?</AlertDialogTitle>
				<div
					data-qa-id="session-delete-worktree-items"
					className="bg-foreground/6 ring-foreground/6 divide-foreground/6 my-1 w-full divide-y rounded-lg ring-1 ring-inset"
				>
					{title ? (
						<div className="flex h-9 min-w-0 items-center gap-2 px-2.5">
							<MessageSquareIcon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
							<span className="truncate text-sm font-medium">{title}</span>
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

class WorktreeRemovalError extends Error {}

/**
 * Deletes a session and its worktree, toasting the outcome: the branch on
 * success, why on failure (the session is deleted either way once the
 * removal starts).
 */
export function removeSessionAndWorktree(
	remove: () => Promise<{ deleted: boolean; worktreeError?: string | undefined }>,
	worktreeBranch: string | null,
): void {
	const removing = remove().then((result) => {
		if (result.worktreeError !== undefined) throw new WorktreeRemovalError(result.worktreeError);
		return result;
	});
	toast.promise(removing, {
		loading: "Removing worktree…",
		success: () => ({
			message: "Worktree deleted",
			description: worktreeBranch
				? `Branch ${worktreeBranch} and its worktree were removed.`
				: undefined,
		}),
		error: (error: unknown) =>
			error instanceof WorktreeRemovalError
				? {
						message: "Could not remove worktree",
						description: error.message || "The worktree was left in place.",
						duration: Infinity,
					}
				: {
						message: "Could not delete session",
						description: error instanceof Error ? error.message : "The session was not deleted.",
					},
	});
}

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

type MenuContribution = Contribution<typeof SessionMenu>;

/** Plugins' menu items that apply to this session, split into ordinary and destructive. */
function useContributedItems(session: WorkSession): {
	ordinary: MenuContribution[];
	destructive: MenuContribution[];
} {
	const items = useExtensions(SessionMenu).filter((item) => {
		const implementation = item.implementation as SessionMenuItem | undefined;
		return implementation && (implementation.appliesTo?.(session) ?? true);
	});
	return {
		ordinary: items.filter((item) => !item.metadata.destructive),
		destructive: items.filter((item) => item.metadata.destructive),
	};
}

function ContributedItem({ item, session }: { item: MenuContribution; session: WorkSession }) {
	const implementation = item.implementation as SessionMenuItem;
	const run = (choiceId?: string) => {
		void Promise.resolve()
			.then(() =>
				choiceId === undefined
					? implementation.run(session)
					: implementation.run(session, choiceId),
			)
			.catch(reportFailure(`Could not ${item.metadata.title.toLowerCase()}`, "Nothing changed."));
	};
	const choices = implementation.choices?.(session);
	if (choices) {
		const checked = choices.find((choice) => choice.checked)?.id ?? "";
		return (
			<DropdownMenuSub>
				<DropdownMenuSubTrigger data-qa-id={`session-menu-${item.key}`}>
					{item.metadata.title}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="w-auto">
					<DropdownMenuRadioGroup value={checked} onValueChange={(id: string) => run(id)}>
						{choices.map((choice) => (
							<DropdownMenuRadioItem
								key={choice.id}
								value={choice.id}
								closeOnClick
								data-qa-id={`session-menu-${item.key}-${choice.id}`}
							>
								{choice.title}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuSubContent>
			</DropdownMenuSub>
		);
	}
	return (
		<DropdownMenuItem
			data-qa-id={`session-menu-${item.key}`}
			{...(item.metadata.destructive ? { variant: "destructive" as const } : {})}
			onClick={() => run()}
		>
			{item.metadata.title}
		</DropdownMenuItem>
	);
}

export const SessionRowMenu: FC<{
	session: WorkSession;
	onPin: () => void;
	/** Without it (a surface with no inline rename) the menu has no Rename item. */
	onRename?: (() => void) | undefined;
	onArchive: () => void;
	onRestore: () => void;
	onDelete: () => void;
	/** Lets inline rename return focus to the menu that started it. */
	triggerRef?: RefObject<HTMLButtonElement | null> | undefined;
	label?: string;
	side?: "right" | "bottom";
}> = ({
	session,
	onPin,
	onRename,
	onArchive,
	onRestore,
	onDelete,
	triggerRef,
	label = "Session actions",
	side = "right",
}) => {
	return (
		<DropdownMenu>
			<MoreActionsTrigger
				triggerRef={triggerRef}
				data-slot="aui_session-list-item-more"
				data-qa-id="session-list-item-more"
				aria-label={label}
			/>
			<DropdownMenuContent
				align="end"
				side={side}
				sideOffset={side === "right" ? 6 : 4}
				className={SESSION_MENU_WIDTH_CLASS_NAME}
			>
				<SessionRowMenuItems
					session={session}
					onPin={onPin}
					onRename={onRename}
					onArchive={onArchive}
					onRestore={onRestore}
					onDelete={onDelete}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/**
 * The menu's items, mounted while it is open, so plugins' `appliesTo` and
 * `choices` read their state when the menu opens rather than when the row
 * last rendered.
 */
export const SessionRowMenuItems: FC<{
	session: WorkSession;
	onPin: () => void;
	onRename?: (() => void) | undefined;
	onArchive: () => void;
	onRestore: () => void;
	onDelete: () => void;
}> = ({ session, onPin, onRename, onArchive, onRestore, onDelete }) => {
	const contributed = useContributedItems(session);
	return (
		<>
			{session.archived ? null : (
				<DropdownMenuItem data-qa-id="session-menu-pin" onClick={onPin}>
					{session.pinned ? <PinOffIcon /> : <PinIcon />}
					{session.pinned ? "Unpin" : "Pin"}
				</DropdownMenuItem>
			)}
			{onRename ? (
				<DropdownMenuItem data-qa-id="session-menu-rename" onClick={onRename}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
			) : null}
			{session.archived ? (
				<DropdownMenuItem data-qa-id="session-menu-restore" onClick={onRestore}>
					<ArchiveRestoreIcon />
					Restore
				</DropdownMenuItem>
			) : (
				<DropdownMenuItem data-qa-id="session-menu-archive" onClick={onArchive}>
					<ArchiveIcon />
					Archive
				</DropdownMenuItem>
			)}
			{contributed.ordinary.length > 0 ? <DropdownMenuSeparator /> : null}
			{contributed.ordinary.map((item) => (
				<ContributedItem key={item.key} item={item} session={session} />
			))}
			{/* Destructive actions last, set apart, as in the app's other menus. */}
			<DropdownMenuSeparator />
			{contributed.destructive.map((item) => (
				<ContributedItem key={item.key} item={item} session={session} />
			))}
			<DropdownMenuItem variant="destructive" data-qa-id="session-menu-delete" onClick={onDelete}>
				<Trash2Icon />
				Delete
			</DropdownMenuItem>
		</>
	);
};

/** Inline rename: commits on Enter or blur, says why and keeps editing when the rename fails. */
export const SessionRenameInput: FC<{
	title: string;
	onRename: (title: string) => Promise<unknown>;
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
					reportFailure("Could not rename session", "The session was not renamed.")(error);
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
			data-qa-id="session-list-item-rename"
			aria-label="Rename session"
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
