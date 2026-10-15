import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk";
import { z } from "zod";

import {
	addColumn,
	clearBoard,
	DEFAULT_WORKSPACE_BOARD,
	deleteColumn,
	moveColumn,
	placeSession,
	removeSession,
	renameColumn,
	type WorkspaceBoardState,
} from "../../contracts/workspace-board/board-model.js";
import {
	WORKSPACE_BOARD_MAX_COLUMNS,
	workspaceBoardContract,
	workspaceBoardStateSchema,
} from "../../contracts/workspace-board/schemas.js";

const storedSchema = z.object({ version: z.literal(1), state: workspaceBoardStateSchema });

export type WorkspaceBoardStore = {
	snapshot: () => unknown;
	set: (value: { version: number; state: WorkspaceBoardState }) => void;
};

/**
 * Owns the persisted workspace board: its user-editable columns, which Kilo
 * sessions the user has placed on it, in which column, and in what order.
 * Deleting a column never drops cards; they move to a neighbouring column, and
 * the last column cannot be deleted. The main process is the single writer; the
 * renderer applies the same pure operations optimistically and reconciles from the
 * returned state. Each handler reads the durable snapshot instead of caching it.
 * Invalid or unsupported snapshots read as the default board without a destructive
 * read-time rewrite; the next successful mutation replaces them. The renderer
 * removes a chat's card when it deletes that chat; otherwise card ids that no
 * longer match a known session are kept and hidden, because the session list is
 * paginated and an unloaded session is indistinguishable from a deleted one here.
 */
export function registerWorkspaceBoard(
	mainSdk: MainSdk,
	store: WorkspaceBoardStore = mainSdk.storage.kv({
		namespace: "workspace-board",
		defaults: { version: 1, state: DEFAULT_WORKSPACE_BOARD },
	}),
): void {
	const read = (): WorkspaceBoardState => {
		const parsed = storedSchema.safeParse(store.snapshot());
		if (parsed.success) return parsed.data.state;
		mainSdk.logger.warn(
			"Stored workspace board is invalid or unsupported; using the default board until the next change.",
		);
		return DEFAULT_WORKSPACE_BOARD;
	};
	const commit = (before: WorkspaceBoardState, after: WorkspaceBoardState): WorkspaceBoardState => {
		if (after === before) return before;
		const parsed = workspaceBoardStateSchema.safeParse(after);
		// Inputs are validated by the contract and column limits are checked per
		// handler, so the board's card limit is the only way a result can fail.
		if (!parsed.success) throw new FeatureError("The board is full.", "VALIDATION");
		try {
			store.set({ version: 1, state: parsed.data });
		} catch (error) {
			mainSdk.logger.error("Could not persist the workspace board.", error);
			throw new FeatureError("Could not save the board. Please try again.", "BUSINESS");
		}
		mainSdk.events.emit("workspace-board-changed", undefined);
		return parsed.data;
	};

	const readWithColumn = (columnId: string): WorkspaceBoardState => {
		const before = read();
		if (!before.columns.some((column) => column.id === columnId)) {
			throw new FeatureError("Board column not found.", "NOT_FOUND");
		}
		return before;
	};

	mainSdk.channels(workspaceBoardContract).handleAll({
		"workspaceBoard.get": async () => read(),
		"workspaceBoard.place": async ({ sessionId, columnId, index }) => {
			const before = readWithColumn(columnId);
			return commit(before, placeSession(before, sessionId, columnId, index));
		},
		"workspaceBoard.remove": async ({ sessionId }) => {
			const before = read();
			return commit(before, removeSession(before, sessionId));
		},
		"workspaceBoard.clear": async () => {
			const before = read();
			return commit(before, clearBoard(before));
		},
		"workspaceBoard.addColumn": async ({ columnId, label }) => {
			const before = read();
			if (before.columns.some((column) => column.id === columnId)) {
				throw new FeatureError("That column already exists.", "VALIDATION");
			}
			if (before.columns.length >= WORKSPACE_BOARD_MAX_COLUMNS) {
				throw new FeatureError(
					`A board can have at most ${WORKSPACE_BOARD_MAX_COLUMNS} columns.`,
					"BUSINESS",
				);
			}
			return commit(before, addColumn(before, columnId, label));
		},
		"workspaceBoard.renameColumn": async ({ columnId, label }) => {
			const before = readWithColumn(columnId);
			return commit(before, renameColumn(before, columnId, label));
		},
		"workspaceBoard.moveColumn": async ({ columnId, index }) => {
			const before = readWithColumn(columnId);
			return commit(before, moveColumn(before, columnId, index));
		},
		"workspaceBoard.deleteColumn": async ({ columnId }) => {
			const before = readWithColumn(columnId);
			if (before.columns.length === 1) {
				throw new FeatureError("A board needs at least one column.", "BUSINESS");
			}
			return commit(before, deleteColumn(before, columnId));
		},
	});
}
