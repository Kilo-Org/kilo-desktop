import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { Dialog, Navigation } from "@kilo-desktop/plugin-shell/contracts";
import {
	WorkSessionListAction,
	WorkSessionMenu,
	WorkSessionsView,
	WorkSessionsWindow,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { BOARD_COMMANDS, BOARD_VIEW, CLEAR_BOARD_DIALOG } from "../contracts";
import {
	addColumnForNaming,
	requestClear,
	setClearDialogOpener,
	showBoard,
	toggleBoard,
} from "./board-actions";
import { createBoardStore, setBoardStore } from "./board-store";
import { BoardHeaderActions } from "./BoardHeaderActions";
import { BoardToggle } from "./BoardToggle";
import { BoardView } from "./BoardView";
import { ClearBoardShellDialog } from "./ClearBoardDialog";
import { BOARD_MENU_ITEMS } from "./session-menu";
import { startTelemetry } from "./telemetry";
import { clearDialog, resetUiState } from "./ui-state";

/** The width that shows every column, so a popped-out board opens without scrolling sideways. */
function columnsWidth(): number | undefined {
	const strip = document.querySelector<HTMLElement>("[data-board-columns]");
	const lastColumn = strip?.querySelector(":scope > [data-board-column]:last-of-type");
	if (!strip || !lastColumn) return undefined;
	const end =
		lastColumn.getBoundingClientRect().right -
		strip.getBoundingClientRect().left +
		strip.scrollLeft;
	return Math.ceil(end + Number.parseFloat(getComputedStyle(strip).paddingRight));
}

/**
 * kilo.workspace-board's renderer entry: the board as a work sessions view
 * and its work-session-menu items in every window (kilo.work-sessions shows
 * it in place or in its own window), and in the main window its list toggle,
 * clear confirmation (a `kilo.shell/dialog`) and commands. Every other
 * plugin's domain object is looked up per call, so the board activates
 * without kilo.work-sessions' objects, kilo.shell or telemetry consent.
 */
export const boardWebEntry = definePlugin({
	activate(sdk) {
		resetUiState();
		setBoardStore(createBoardStore(sdk));
		startTelemetry(sdk);
		sdk.extensions.implement(WorkSessionsView, "board", {
			component: BoardView,
			headerActions: BoardHeaderActions,
			preferredWidth: columnsWidth,
		});
		// The cards' session menu shows wherever the board does, popped out included.
		for (const [id, item] of Object.entries(BOARD_MENU_ITEMS)) {
			sdk.extensions.implement(WorkSessionMenu, id, item);
		}
		if (sdk.context.get("kernel/secondaryWindow")) {
			setClearDialogOpener(() => clearDialog.set(true));
			return;
		}
		setClearDialogOpener(
			() =>
				void sdk.domainObjects
					.get(Navigation)
					?.methods.openDialog({ dialog: CLEAR_BOARD_DIALOG })
					.catch(() => undefined),
		);
		sdk.extensions.implement(WorkSessionListAction, "board", BoardToggle);
		sdk.extensions.implement(Dialog, "clear-board", ClearBoardShellDialog);
		const window = () => sdk.domainObjects.get(WorkSessionsWindow);
		const command = (id: string, run: () => void) =>
			sdk.extensions.implement(KernelCommand, id, run);
		command(BOARD_COMMANDS.toggle, () => toggleBoard(window(), "command"));
		command(BOARD_COMMANDS.addColumn, () => {
			if (window()?.getState().view !== BOARD_VIEW) showBoard(window(), "command");
			addColumnForNaming();
		});
		command(BOARD_COMMANDS.clear, requestClear);
	},
});
