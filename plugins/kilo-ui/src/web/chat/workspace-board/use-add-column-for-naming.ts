import { useCallback, useState } from "react";

import { WORKSPACE_BOARD_MAX_COLUMNS } from "../../../contracts/workspace-board/schemas.js";
import { NEW_COLUMN_LABEL } from "./workspace-board-constants.js";
import type { WorkspaceBoardContextValue } from "./WorkspaceBoardProvider.js";

/**
 * Adding a column appends a "New column" and has its header open the name for
 * editing; this holds which column that is until its header has picked it up.
 */
export function useAddColumnForNaming(board: WorkspaceBoardContextValue) {
	const [columnToName, setColumnToName] = useState<string | null>(null);
	const { addColumn } = board;
	const add = useCallback(() => setColumnToName(addColumn(NEW_COLUMN_LABEL)), [addColumn]);
	const onColumnNamingStarted = useCallback(() => setColumnToName(null), []);
	const canAdd = board.board.columns.length < WORKSPACE_BOARD_MAX_COLUMNS;
	return { onAddColumn: canAdd ? add : undefined, columnToName, onColumnNamingStarted };
}
