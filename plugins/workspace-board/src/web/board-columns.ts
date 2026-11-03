import type { Session } from "@kilo-desktop/plugin-sessions/contracts";
import { UNSCOPED_WORKSPACE_FOCUS } from "@kilo-desktop/plugin-workbench/contracts";

import { deletedColumnDestination, type BoardState } from "../contracts";

export interface BoardColumnView {
	readonly id: string;
	readonly label: string;
	readonly cards: readonly Session[];
	/** Every card in the column, including ones the focus hides or whose session isn't known. */
	readonly cardCount: number;
	/** The column that receives this column's cards if it is deleted. */
	readonly deleteDestination: string | null;
}

export function matchesFocus(session: Session, focus: string | null): boolean {
	if (focus === null) return true;
	if (focus === UNSCOPED_WORKSPACE_FOCUS) return session.workspaceId === null;
	return session.workspaceId === focus;
}

/**
 * The columns as shown: filtered by the session list's workspace focus.
 * Cards whose session isn't known stay on the saved board but aren't shown.
 */
export function resolveColumns(
	board: BoardState,
	sessions: ReadonlyMap<string, Session>,
	focus: string | null,
): BoardColumnView[] {
	return board.columns.map((column) => ({
		id: column.id,
		label: column.label,
		cardCount: column.sessionIds.length,
		deleteDestination: deletedColumnDestination(board, column.id)?.label ?? null,
		cards: column.sessionIds.flatMap((sessionId) => {
			const session = sessions.get(sessionId);
			return session && matchesFocus(session, focus) ? [session] : [];
		}),
	}));
}

/**
 * Items are spans along one axis in visual order; the pointer goes before
 * the first item whose middle is past it.
 */
export function insertionIndex(
	items: readonly { start: number; size: number }[],
	position: number,
): number {
	return items.filter((item) => item.start + item.size / 2 < position).length;
}

/** Every card on the board, whether shown or not. */
export function cardCountOf(board: BoardState): number {
	return board.columns.reduce((count, column) => count + column.sessionIds.length, 0);
}
