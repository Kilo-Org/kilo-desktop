import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { WorkSessionsWindow } from "@kilo-desktop/plugin-work-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { BOARD_TELEMETRY_EVENTS, BOARD_VIEW } from "../contracts";
import { cardCountOf } from "./board-columns";
import { boardStore } from "./board-store";
import { track } from "./telemetry";
import { clearDialog, columnToName, NEW_COLUMN_LABEL } from "./ui-state";

type WindowHandle = DomainObjectHandle<typeof WorkSessionsWindow>;

let openClearDialog: () => void = () => clearDialog.set(true);

/**
 * How this window opens the "Clear the board?" confirmation: through
 * kilo.shell's dialogs in the main window, the board's own dialog in its window.
 */
export function setClearDialogOpener(open: () => void): void {
	openClearDialog = open;
}

/** Appends a "New column" and has the board open its name for editing. */
export function addColumnForNaming(): void {
	const columnId = boardStore().addColumn(NEW_COLUMN_LABEL);
	if (!columnId) return;
	columnToName.set(columnId);
	track(BOARD_TELEMETRY_EVENTS.columnAdded);
}

/** Asks to clear the board, unless there is nothing on it. */
export function requestClear(): void {
	if (cardCountOf(boardStore().snapshot()) === 0) {
		toast.info("The board is already empty");
		return;
	}
	openClearDialog();
}

/** Shows the board in this window (or brings its window forward). */
export function showBoard(window: WindowHandle | null, source: string): void {
	if (!window) return;
	const { view, detachedViews } = window.getState();
	if (view !== BOARD_VIEW && !detachedViews.includes(BOARD_VIEW)) {
		track(BOARD_TELEMETRY_EVENTS.opened, { source });
	}
	void window.methods.showView({ view: BOARD_VIEW }).catch(() => undefined);
}

/** Shows the board, or goes back to the open session while it is shown. */
export function toggleBoard(window: WindowHandle | null, source: string): void {
	if (window?.getState().view === BOARD_VIEW) {
		void window.methods.showView({ view: null }).catch(() => undefined);
		return;
	}
	showBoard(window, source);
}
