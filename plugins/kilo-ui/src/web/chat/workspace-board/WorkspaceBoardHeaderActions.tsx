import { BrushCleaningIcon } from "lucide-react";
import { useState } from "react";

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

import { useWorkspaceBoard } from "./WorkspaceBoardProvider.js";

/**
 * The board page's title-bar actions, styled like the chat page's header
 * toolbar (ghost icon buttons on the shell glass). Clearing takes every card off so the board can start fresh (e.g. each
 * morning); columns and the chats themselves stay.
 */
export function WorkspaceBoardHeaderActions() {
	const board = useWorkspaceBoard();
	const [confirming, setConfirming] = useState(false);
	if (!board) return null;
	// Every card, including ones the workspace filter hides or that are not loaded.
	const cardCount = board.board.columns.reduce(
		(count, column) => count + column.sessionIds.length,
		0,
	);
	const empty = cardCount === 0;

	return (
		<div className="-mr-1 flex items-center gap-1 [-webkit-app-region:no-drag]">
			<Tooltip>
				<TooltipTrigger
					render={
						// A wrapper keeps the tooltip working while the button is disabled.
						<span className="inline-flex" />
					}
				>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={empty ? "Clear board (the board is empty)" : "Clear board"}
						data-qa-id="workspace-board-clear"
						disabled={empty}
						onClick={() => setConfirming(true)}
					>
						<BrushCleaningIcon className="size-3.5" aria-hidden />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{empty ? "The board is already empty" : "Clear board"}
				</TooltipContent>
			</Tooltip>
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
		</div>
	);
}

function clearDescription(cardCount: number): string {
	const chats = cardCount === 1 ? "the chat" : `all ${cardCount} chats`;
	return `This takes ${chats} off the board. Your columns and the chats themselves are kept.`;
}
