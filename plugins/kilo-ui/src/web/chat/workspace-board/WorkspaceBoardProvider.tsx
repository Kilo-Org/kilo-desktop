import {
	createContext,
	use,
	useCallback,
	useMemo,
	useSyncExternalStore,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";

import { useFeatureFlag, useSdk } from "@kilo-desktop/sdk-react";

import type { WorkspaceBoardState } from "../../../contracts/workspace-board/board-model.js";
import {
	WORKSPACE_BOARD_FEATURE_FLAG,
	WORKSPACE_BOARD_ROUTE_PATH,
} from "./workspace-board-constants.js";

import type { BoardDragItem, BoardDrop } from "./workspace-board-drag-target.js";
import { useAddColumnForNaming, type ColumnNaming } from "./use-add-column-for-naming.js";
import { useWorkspaceBoardDrag } from "./use-workspace-board-drag.js";
import { useWorkspaceBoardStore } from "./use-workspace-board-store.js";
import {
	useWorkspaceBoardWindow,
	type WorkspaceBoardWindow,
} from "./use-workspace-board-window.js";

export type WorkspaceBoardContextValue = {
	board: WorkspaceBoardState;
	/** The board page is on screen. Sidebar rows only drag while it can receive them. */
	isOpen: boolean;
	addToColumn: (sessionId: string, columnId: string) => void;
	remove: (sessionId: string) => void;
	/** Takes every card off the board; columns stay. */
	clear: () => void;
	/** Adding a column from the title bar and opening its name on the board. */
	columnNaming: ColumnNaming;
	renameColumn: (columnId: string, label: string) => void;
	moveColumn: (columnId: string, index: number) => void;
	/** Moves the column's cards to its neighbour; the last column is never deleted. */
	deleteColumn: (columnId: string) => void;
	/** Pointer-down handler that begins dragging a chat or a column. */
	startDrag: (event: ReactPointerEvent<HTMLElement>, item: BoardDragItem) => void;
	/** The board's pop-out window, as seen from this window (main or pop-out). */
	window: WorkspaceBoardWindow;
};

const WorkspaceBoardContext = createContext<WorkspaceBoardContextValue | null>(null);

/** Null when the board feature is off or no provider is mounted. */
export function useWorkspaceBoard(): WorkspaceBoardContextValue | null {
	return use(WorkspaceBoardContext);
}

function useIsBoardRoute(): boolean {
	const sdk = useSdk("kilo-ui");
	const subscribe = useCallback((onChange: () => void) => sdk.location.subscribe(onChange), [sdk]);
	return useSyncExternalStore(
		subscribe,
		() => sdk.location.peek().path === WORKSPACE_BOARD_ROUTE_PATH,
	);
}

/**
 * App-lifetime owner of the workspace board's state and its one drag controller.
 * It sits beside the chat runtime rather than in the board page because drags
 * start in the shell sidebar and land on the page. Drags preview with reversible
 * DOM changes and commit once on drop through the store's optimistic `place`
 * (chats) or `moveColumn` (columns).
 *
 * Gated by the `workspace-board` feature flag: while off, the context is null so
 * the sidebar shows no board affordances and the board query never runs.
 *
 * Every window mounts its own provider; a popped-out board window shares the
 * persisted board with the main window through the store's change event.
 */
export function WorkspaceBoardProvider({ children }: { children: ReactNode }) {
	const enabled = useFeatureFlag(WORKSPACE_BOARD_FEATURE_FLAG, false);
	const isOpen = useIsBoardRoute();
	const { board, place, remove, clear, addColumn, renameColumn, moveColumn, deleteColumn } =
		useWorkspaceBoardStore(enabled);
	const onDrop = useCallback(
		(drop: BoardDrop) => {
			if (drop.kind === "column") moveColumn(drop.columnId, drop.index);
			else place(drop.sessionId, drop.columnId, drop.index);
		},
		[moveColumn, place],
	);
	const { startDrag } = useWorkspaceBoardDrag(onDrop);
	const boardWindow = useWorkspaceBoardWindow(enabled);
	const columnNaming = useAddColumnForNaming(board.columns.length, addColumn);

	// Placement clamps to the column's length, so the largest index means "at the
	// end" without reading the board, which keeps this callback stable.
	const addToColumn = useCallback(
		(sessionId: string, columnId: string) => place(sessionId, columnId, Number.MAX_SAFE_INTEGER),
		[place],
	);

	const value = useMemo<WorkspaceBoardContextValue>(
		() => ({
			board,
			clear,
			isOpen,
			addToColumn,
			remove,
			columnNaming,
			renameColumn,
			moveColumn,
			deleteColumn,
			startDrag,
			window: boardWindow,
		}),
		[
			columnNaming,
			addToColumn,
			board,
			boardWindow,
			clear,
			deleteColumn,
			isOpen,
			moveColumn,
			remove,
			renameColumn,
			startDrag,
		],
	);

	return <WorkspaceBoardContext value={enabled ? value : null}>{children}</WorkspaceBoardContext>;
}
