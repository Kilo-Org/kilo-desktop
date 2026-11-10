import type { DialogProps } from "@kilo-desktop/plugin-shell/contracts";
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

import { BOARD_TELEMETRY_EVENTS } from "../contracts";
import { cardCountOf } from "./board-columns";
import { boardStore, useBoardState } from "./board-store";
import { track } from "./telemetry";
import { clearDialog, useSignal } from "./ui-state";

/**
 * Confirms taking every card off the board (e.g. to start fresh each
 * morning); columns and sessions stay. In the main window kilo.shell mounts
 * it as a `kilo.shell/dialog` while it is open; in the board's own window
 * the board mounts it, opened by a signal.
 */
function ClearBoardConfirmation({
	open,
	onOpenChange,
}: {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
}) {
	const board = useBoardState();
	// Every card, including ones the workspace focus hides.
	const cardCount = cardCountOf(board);
	const sessions = cardCount === 1 ? "the session" : `all ${cardCount} sessions`;
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
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
							onOpenChange(false);
							boardStore().clear();
							track(BOARD_TELEMETRY_EVENTS.cleared, { cards: cardCount });
						}}
					>
						Clear board
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** The confirmation as the main window's `kilo.shell/dialog` `clear-board`. */
export function ClearBoardShellDialog({ close }: DialogProps) {
	return (
		<ClearBoardConfirmation
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		/>
	);
}

/** The confirmation in the board's own window. */
export function ClearBoardDialog() {
	const open = useSignal(clearDialog);
	return <ClearBoardConfirmation open={open} onOpenChange={(next) => clearDialog.set(next)} />;
}
