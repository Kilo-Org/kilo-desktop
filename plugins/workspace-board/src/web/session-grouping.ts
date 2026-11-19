import type {
	WorkSessionGroup,
	WorkSessionGroupingSource,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import type { BoardState } from "../contracts";
import type { BoardStore } from "./board-store";

/**
 * The board's columns as a session list grouping (`work-session-grouping`).
 * It follows the store, pending moves included, so the list moves a session
 * when the board does.
 */
export function createBoardGrouping(store: BoardStore): WorkSessionGroupingSource {
	let board: BoardState | null = null;
	let groups: readonly WorkSessionGroup[] = [];
	return {
		get() {
			const next = store.snapshot();
			if (next !== board) {
				board = next;
				groups = next.columns.map((column) => ({
					id: column.id,
					label: column.label,
					workSessionIds: column.sessionIds,
				}));
			}
			return groups;
		},
		subscribe: (listener) => store.subscribe(listener),
	};
}
