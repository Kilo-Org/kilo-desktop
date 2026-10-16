import { useCallback, useMemo, useState } from "react";

import { WORKSPACE_BOARD_MAX_COLUMNS } from "../../../contracts/workspace-board/schemas.js";
import { NEW_COLUMN_LABEL } from "./workspace-board-constants.js";

export type ColumnNaming = {
	/** Appends a "New column" for naming; absent once the board holds the most columns it may. */
	add: (() => void) | undefined;
	/** A just-added column whose header should open its name for editing. */
	columnToName: string | null;
	onNamingStarted: () => void;
};

/**
 * Adding a column appends a "New column" and has its header open the name for
 * editing; this holds which column that is until its header has picked it up.
 * The title bar adds and the board names, so this lives with the board's state.
 */
export function useAddColumnForNaming(
	columnCount: number,
	addColumn: (label: string) => string,
): ColumnNaming {
	const [columnToName, setColumnToName] = useState<string | null>(null);
	const add = useCallback(() => setColumnToName(addColumn(NEW_COLUMN_LABEL)), [addColumn]);
	const onNamingStarted = useCallback(() => setColumnToName(null), []);
	const canAdd = columnCount < WORKSPACE_BOARD_MAX_COLUMNS;
	return useMemo(
		() => ({ add: canAdd ? add : undefined, columnToName, onNamingStarted }),
		[add, canAdd, columnToName, onNamingStarted],
	);
}
