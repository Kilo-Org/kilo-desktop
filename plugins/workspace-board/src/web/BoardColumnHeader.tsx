import { ArrowLeftIcon, ArrowRightIcon, EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

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
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { BoardColumnView } from "./board-columns";
import { ColumnNameInput } from "./ColumnNameInput";

/** Dragging a column carries its id in this board-private format. */
export const COLUMN_DRAG_FORMAT = "application/x-kilo-board-column";

/**
 * Same reveal as the session list's row actions, while the column is hovered —
 * but not while a card in it is, since the card shows its own menu then.
 */
const columnActionClassName = cn(
	"ml-auto pointer-events-none opacity-0 transition-opacity motion-reduce:transition-none",
	"[[data-board-column]:hover:not(:has([data-board-card]:hover))_&]:pointer-events-auto",
	"[[data-board-column]:hover:not(:has([data-board-card]:hover))_&]:opacity-100",
	"focus-visible:pointer-events-auto focus-visible:opacity-100",
	"data-[popup-open]:pointer-events-auto data-[popup-open]:opacity-100",
);

/** Names the column's region after its heading. */
export const headingId = (columnId: string) => `workspace-board-column-heading-${columnId}`;

const sessionCount = (count: number) => (count === 1 ? "1 session" : `${count} sessions`);

export function BoardColumnHeader({
	column,
	index,
	columnCount,
	startNaming,
	onNamingStarted,
	onRename,
	onMove,
	onDelete,
	onDragStart,
	onDragEnd,
}: {
	readonly column: BoardColumnView;
	readonly index: number;
	readonly columnCount: number;
	/** The column was just added: open its name for editing. */
	readonly startNaming: boolean;
	readonly onNamingStarted: () => void;
	readonly onRename: (label: string) => void;
	readonly onMove: (index: number) => void;
	readonly onDelete: () => void;
	readonly onDragStart: () => void;
	readonly onDragEnd: () => void;
}) {
	const [renaming, setRenaming] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const headerRef = useRef<HTMLElement>(null);

	const [namingRequested, setNamingRequested] = useState(false);
	if (namingRequested !== startNaming) {
		setNamingRequested(startNaming);
		if (startNaming) setRenaming(true);
	}

	useEffect(() => {
		if (!startNaming) return;
		headerRef.current?.scrollIntoView?.({ block: "nearest" });
		onNamingStarted();
	}, [onNamingStarted, startNaming]);

	const requestDelete = () => {
		if (column.cardCount > 0) setConfirmingDelete(true);
		else onDelete();
	};
	const startDrag = (event: DragEvent<HTMLElement>) => {
		event.dataTransfer.setData(COLUMN_DRAG_FORMAT, column.id);
		event.dataTransfer.effectAllowed = "move";
		onDragStart();
	};
	const hiddenCount = column.cardCount - column.cards.length;

	return (
		<header
			ref={headerRef}
			data-qa-id={`workspace-board-column-header-${column.id}`}
			draggable={!renaming}
			onDragStart={renaming ? undefined : startDrag}
			onDragEnd={onDragEnd}
			// h-10: the column's card scroll cap subtracts this height (BoardView).
			className={cn("flex h-10 shrink-0 items-center gap-2 px-3", !renaming && "cursor-grab")}
		>
			{renaming ? (
				<ColumnNameInput
					id={headingId(column.id)}
					label={column.label}
					onSubmit={(label) => {
						onRename(label);
						setRenaming(false);
					}}
					onCancel={() => setRenaming(false)}
				/>
			) : (
				<>
					<h2
						id={headingId(column.id)}
						className="min-w-0 truncate text-sm font-medium"
						onDoubleClick={() => setRenaming(true)}
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
						<DropdownMenuTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label={`Column actions for ${column.label}`}
									data-qa-id={`workspace-board-column-menu-${column.id}`}
									className={columnActionClassName}
								/>
							}
						>
							<EllipsisIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								data-qa-id="workspace-board-column-rename-action"
								onClick={() => setRenaming(true)}
							>
								<PencilIcon />
								Rename
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								disabled={index === 0}
								data-qa-id="workspace-board-column-move-left"
								onClick={() => onMove(index - 1)}
							>
								<ArrowLeftIcon />
								Move left
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={index === columnCount - 1}
								data-qa-id="workspace-board-column-move-right"
								onClick={() => onMove(index + 1)}
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
						<AlertDialogDescription>
							This moves{" "}
							{column.cardCount === 1 ? "its session" : `its ${column.cardCount} sessions`}
							{hiddenCount > 0 ? ` (${hiddenCount} not shown)` : ""} to “{column.deleteDestination}
							”. The sessions themselves are not deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							data-qa-id="workspace-board-column-delete-confirm"
							onClick={() => {
								setConfirmingDelete(false);
								onDelete();
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
