import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { SessionMenu } from "@kilo-desktop/plugin-sessions/contracts";
import { Overlay } from "@kilo-desktop/plugin-shell/contracts";
import { Navigator, NavigatorAction, SessionsView } from "@kilo-desktop/plugin-workbench/contracts";

import { BOARD_VIEW } from "../contracts";
import { addColumnForNaming, requestClear, showBoard, toggleBoard } from "./board-actions";
import { createBoardStore, setBoardStore } from "./board-store";
import { BoardHeaderActions } from "./BoardHeaderActions";
import { BoardToggle } from "./BoardToggle";
import { BoardView } from "./BoardView";
import { ClearBoardDialog } from "./ClearBoardDialog";
import { BOARD_MENU_ITEMS } from "./session-menu";
import { startTelemetry } from "./telemetry";
import { resetUiState } from "./ui-state";

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
 * kilo.workspace-board's renderer entry: the board as a sessions view and its
 * session-menu items in every window (the workbench shows it in place or in its
 * own window), and in the main window its toggle, clear confirmation and commands.
 */
export const boardWebEntry = definePlugin({
	activate(sdk) {
		resetUiState();
		setBoardStore(createBoardStore(sdk));
		startTelemetry(sdk);
		sdk.extensions.implement(SessionsView, "board", {
			component: BoardView,
			headerActions: BoardHeaderActions,
			preferredWidth: columnsWidth,
		});
		// The cards' session menu shows wherever the board does, popped out included.
		for (const [id, item] of Object.entries(BOARD_MENU_ITEMS)) {
			sdk.extensions.implement(SessionMenu, id, item);
		}
		if (sdk.context.get("kernel/secondaryWindow")) return;
		sdk.extensions.implement(NavigatorAction, "board", BoardToggle);
		sdk.extensions.implement(Overlay, "clear-board", ClearBoardDialog);
		const navigator = () => sdk.domains.get(Navigator);
		const command = (id: string, run: () => void) =>
			sdk.extensions.implement(KernelCommand, id, run);
		command("open", () => toggleBoard(navigator(), "command"));
		command("add-column", () => {
			if (navigator()?.getState().view !== BOARD_VIEW) showBoard(navigator(), "command");
			addColumnForNaming();
		});
		command("clear", requestClear);
	},
});
