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

import { cardCountOf } from "./board-columns";
import { boardStore, useBoardState } from "./board-store";
import { BOARD_EVENTS, track } from "./telemetry";
import { clearDialog, useSignal } from "./ui-state";

/**
 * Confirms taking every card off the board (e.g. to start fresh each
 * morning); columns and sessions stay. Mounted once per window: by
 * kilo.shell/overlay in the main window, by the board itself in its own.
 */
export function ClearBoardDialog() {
	const open = useSignal(clearDialog);
	const board = useBoardState();
	// Every card, including ones the workspace focus hides.
	const cardCount = cardCountOf(board);
	const sessions = cardCount === 1 ? "the session" : `all ${cardCount} sessions`;
	return (
		<AlertDialog open={open} onOpenChange={(next) => clearDialog.set(next)}>
			<AlertDialogContent data-qa-id="workspace-board-clear-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>Clear the board?</AlertDialogTitle>
					<AlertDialogDescription>
						This takes {sessions} off the board. Your columns and the sessions themselves are kept.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						data-qa-id="workspace-board-clear-confirm"
						onClick={() => {
							clearDialog.set(false);
							boardStore().clear();
							track(BOARD_EVENTS.cleared, { cards: cardCount });
						}}
					>
						Clear board
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
