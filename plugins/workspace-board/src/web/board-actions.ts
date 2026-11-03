import type { DomainHandle } from "@kilo-desktop/kernel";
import type { Navigator } from "@kilo-desktop/plugin-workbench/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { BOARD_VIEW } from "../contracts";
import { cardCountOf } from "./board-columns";
import { boardStore } from "./board-store";
import { BOARD_EVENTS, track } from "./telemetry";
import { clearDialog, columnToName, NEW_COLUMN_LABEL } from "./ui-state";

type NavigatorHandle = DomainHandle<typeof Navigator>;

/** Appends a "New column" and has the board open its name for editing. */
export function addColumnForNaming(): void {
	const columnId = boardStore().addColumn(NEW_COLUMN_LABEL);
	if (!columnId) return;
	columnToName.set(columnId);
	track(BOARD_EVENTS.columnAdded);
}

/** Asks to clear the board, unless there is nothing on it. */
export function requestClear(): void {
	if (cardCountOf(boardStore().snapshot()) === 0) {
		toast.info("The board is already empty");
		return;
	}
	clearDialog.set(true);
}

/** Shows the board in this window (or brings its window forward). */
export function showBoard(navigator: NavigatorHandle | null, source: string): void {
	if (!navigator) return;
	const { view, detachedViews } = navigator.getState();
	if (view !== BOARD_VIEW && !detachedViews.includes(BOARD_VIEW)) {
		track(BOARD_EVENTS.opened, { source });
	}
	void navigator.methods.showView({ view: BOARD_VIEW }).catch(() => undefined);
}

/** Shows the board, or goes back to the open session while it is shown. */
export function toggleBoard(navigator: NavigatorHandle | null, source: string): void {
	if (navigator?.getState().view === BOARD_VIEW) {
		void navigator.methods.showView({ view: null }).catch(() => undefined);
		return;
	}
	showBoard(navigator, source);
}
