import { ArrowLeftIcon, ArrowRightIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { BoardColumnView } from "./workspace-board-sessions.js";
import { MoreActionsTrigger, useRenameState } from "../components/session-row-actions.js";
import { WorkspaceBoardColumnNameInput } from "./WorkspaceBoardColumnNameInput.js";
import type { BoardDragItem } from "./workspace-board-drag-target.js";

/**
 * Same reveal as the sidebar's row actions, while the column is hovered — but not
 * while a card in it is, since the card shows its own actions menu then.
 */
const columnActionClassName = cn(
	"ml-auto pointer-events-none opacity-0 transition-opacity motion-reduce:transition-none",
	"[[data-workspace-board-column]:hover:not(:has([data-workspace-board-card]:hover))_&]:pointer-events-auto",
	"[[data-workspace-board-column]:hover:not(:has([data-workspace-board-card]:hover))_&]:opacity-100",
	"focus-visible:pointer-events-auto focus-visible:opacity-100",
	"data-[popup-open]:pointer-events-auto data-[popup-open]:opacity-100",
);

export function WorkspaceBoardColumnHeader({
	column,
	index,
	columnCount,
	onRename,
	onMove,
	onDelete,
	onDragStart,
	startNaming = false,
	onNamingStarted,
}: {
	column: BoardColumnView;
	index: number;
	columnCount: number;
	onRename: (columnId: string, label: string) => void;
	onMove: (columnId: string, index: number) => void;
	onDelete: (columnId: string) => void;
	onDragStart: (event: ReactPointerEvent<HTMLElement>, item: BoardDragItem) => void;
	/** The column was just added from the title bar: open its name for editing. */
	startNaming?: boolean;
	onNamingStarted?: (() => void) | undefined;
}) {
	const {
		isRenaming: renaming,
		startRename,
		finishRename,
		triggerRef: menuTriggerRef,
	} = useRenameState();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const headerRef = useRef<HTMLElement>(null);

	useEffect(() => {
		if (!startNaming) return;
		startRename();
		headerRef.current?.scrollIntoView({ block: "nearest" });
		onNamingStarted?.();
	}, [onNamingStarted, startNaming, startRename]);

	const requestDelete = () => {
		if (column.cardCount > 0) setConfirmingDelete(true);
		else onDelete(column.id);
	};

	// The header is the column's drag handle, except its buttons and the rename field.
	// Pointer events from the portalled delete dialog bubble here through React, so
	// only presses on the header's own DOM start a drag.
	const startColumnDrag = (event: ReactPointerEvent<HTMLElement>) => {
		const target = event.target as HTMLElement;
		if (!event.currentTarget.contains(target) || target.closest("button, input")) return;
		onDragStart(event, {
			kind: "column",
			columnId: column.id,
			title: column.label,
			detail: sessionCount(column.cards.length),
		});
	};

	return (
		<header
			ref={headerRef}
			data-qa-id={`workspace-board-column-header-${column.id}`}
			// h-10: the column's card scroll cap subtracts this height (WorkspaceBoardView).
			className={cn(
				"flex h-10 shrink-0 items-center gap-2 px-3",
				!renaming && "cursor-grab touch-none",
			)}
			onPointerDown={renaming ? undefined : startColumnDrag}
		>
			{renaming ? (
				<WorkspaceBoardColumnNameInput
					id={headingId(column.id)}
					label={column.label}
					onSubmit={(label, restoreFocus) => {
						onRename(column.id, label);
						finishRename(restoreFocus);
					}}
					onCancel={finishRename}
				/>
			) : (
				<>
					<h2
						id={headingId(column.id)}
						className="min-w-0 truncate text-sm font-medium"
						onDoubleClick={startRename}
					>
						{column.label}
					</h2>
					<span className="text-muted-foreground text-xs tabular-nums">
						<span aria-hidden data-qa-id={`workspace-board-column-count-${column.id}`}>
							{column.cards.length}
						</span>
						<span className="sr-only">{sessionCount(column.cards.length)}</span>
					</span>
					<DropdownMenu>
						<MoreActionsTrigger
							triggerRef={menuTriggerRef}
							aria-label={`Column actions for ${column.label}`}
							data-qa-id={`workspace-board-column-menu-${column.id}`}
							className={columnActionClassName}
						/>
						<DropdownMenuContent align="end" className="w-auto">
							<DropdownMenuItem
								data-qa-id="workspace-board-column-rename-action"
								onClick={startRename}
							>
								<PencilIcon />
								Rename
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								disabled={index === 0}
								data-qa-id="workspace-board-column-move-left"
								onClick={() => onMove(column.id, index - 1)}
							>
								<ArrowLeftIcon />
								Move left
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={index === columnCount - 1}
								data-qa-id="workspace-board-column-move-right"
								onClick={() => onMove(column.id, index + 1)}
							>
								<ArrowRightIcon />
								Move right
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								disabled={columnCount === 1}
								data-qa-id="workspace-board-column-delete-action"
								onClick={requestDelete}
							>
								<Trash2Icon />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</>
			)}
			<AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
				<AlertDialogContent data-qa-id="workspace-board-column-delete-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {column.label}?</AlertDialogTitle>
						<AlertDialogDescription>{deleteDescription(column)}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							data-qa-id="workspace-board-column-delete-confirm"
							onClick={() => {
								setConfirmingDelete(false);
								onDelete(column.id);
							}}
						>
							Delete column
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</header>
	);
}

/** Counts every session in the column, and says how many of them the board is not showing. */
function deleteDescription(column: BoardColumnView): string {
	const sessions = column.cardCount === 1 ? "its session" : `its ${column.cardCount} sessions`;
	const hidden = column.cardCount - column.cards.length;
	// Includes sessions the workspace filter hides and sessions that are not loaded yet.
	const filtered = hidden > 0 ? ` (${hidden} not shown)` : "";
	return `This moves ${sessions}${filtered} to “${column.deleteDestination}”. The sessions themselves are not deleted.`;
}

/** Names the column's region after its heading. */
export const headingId = (columnId: string) => `workspace-board-column-heading-${columnId}`;

const sessionCount = (count: number) => (count === 1 ? "1 session" : `${count} sessions`);
