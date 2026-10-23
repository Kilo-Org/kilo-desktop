import { BrushCleaningIcon, ExternalLinkIcon, Minimize2Icon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { WORKSPACE_BOARD_MAX_COLUMNS } from "../../../contracts/workspace-board/schemas.js";
import { useWorkspaceBoard } from "./WorkspaceBoardProvider.js";

/**
 * The board's title-bar actions, in the main window's title bar or, once
 * popped out, the board window's own. Adding a column lives here so it is
 * reachable without scrolling the board. Clearing takes every card off so the
 * board can start fresh (e.g. each morning); columns and chats stay.
 */
export function WorkspaceBoardHeaderActions() {
	const board = useWorkspaceBoard();
	const [confirming, setConfirming] = useState(false);
	if (!board || board.window.isPoppedOut) return null;
	// Every card, including ones the workspace filter hides or that are not loaded.
	const cardCount = board.board.columns.reduce(
		(count, column) => count + column.sessionIds.length,
		0,
	);
	const empty = cardCount === 0;
	const { add: addColumn } = board.columnNaming;

	return (
		<div className="-mr-1 flex items-center gap-1 [-webkit-app-region:no-drag]">
			<HeaderIconButton
				label="Add column"
				qaId="workspace-board-add-column"
				disabledReason={
					addColumn ? undefined : `A board can have at most ${WORKSPACE_BOARD_MAX_COLUMNS} columns`
				}
				onClick={() => addColumn?.()}
			>
				<PlusIcon className="size-3.5" aria-hidden />
			</HeaderIconButton>
			<HeaderIconButton
				label="Clear board"
				qaId="workspace-board-clear"
				disabledReason={empty ? "The board is already empty" : undefined}
				onClick={() => setConfirming(true)}
			>
				<BrushCleaningIcon className="size-3.5" aria-hidden />
			</HeaderIconButton>
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent data-qa-id="workspace-board-clear-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>Clear the board?</AlertDialogTitle>
						<AlertDialogDescription>{clearDescription(cardCount)}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							data-qa-id="workspace-board-clear-confirm"
							onClick={() => {
								setConfirming(false);
								board.clear();
							}}
						>
							Clear board
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{board.window.canPopOut ? (
				<HeaderIconButton
					label="Pop out"
					qaId="workspace-board-pop-out"
					onClick={board.window.popOut}
				>
					<ExternalLinkIcon className="size-3.5" aria-hidden />
				</HeaderIconButton>
			) : null}
			{board.window.isDetached ? (
				<HeaderIconButton label="Dock" qaId="workspace-board-dock" onClick={board.window.dock}>
					<Minimize2Icon className="size-3.5" aria-hidden />
				</HeaderIconButton>
			) : null}
		</div>
	);
}

/** Disabled with a reason: the tooltip shows it and the button describes itself with it. */
function HeaderIconButton({
	label,
	qaId,
	disabledReason,
	onClick,
	children,
}: {
	label: string;
	qaId: string;
	disabledReason?: string | undefined;
	onClick: () => void;
	children: ReactNode;
}) {
	const buttonProps = {
		type: "button",
		variant: "ghost",
		size: "icon-sm",
		"aria-label": label,
		"aria-description": disabledReason,
		"data-qa-id": qaId,
		disabled: disabledReason !== undefined,
		onClick,
	} as const;
	return (
		<Tooltip>
			{disabledReason ? (
				// A wrapper keeps the tooltip working while the button is disabled.
				<TooltipTrigger render={<span className="inline-flex" />}>
					<Button {...buttonProps}>{children}</Button>
				</TooltipTrigger>
			) : (
				<TooltipTrigger render={<Button {...buttonProps} />}>{children}</TooltipTrigger>
			)}
			<TooltipContent side="bottom">{disabledReason ?? label}</TooltipContent>
		</Tooltip>
	);
}

function clearDescription(cardCount: number): string {
	const sessions = cardCount === 1 ? "the session" : `all ${cardCount} sessions`;
	return `This takes ${sessions} off the board. Your columns and the sessions themselves are kept.`;
}
