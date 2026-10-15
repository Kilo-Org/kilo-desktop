import { useCallback, useMemo, type PointerEventHandler } from "react";

import { findSessionPlacement } from "../../../contracts/workspace-board/board-model.js";
import { useWorkspaceBoard } from "./WorkspaceBoardProvider.js";
import { UNTITLED_CHAT } from "./workspace-board-sessions.js";

export type SessionRowBoard = {
	/** Starts a drag toward the board; undefined while the board is not on screen. */
	onDragPointerDown: PointerEventHandler<HTMLElement> | undefined;
	placement: { columnId: string; label: string } | null;
	columns: readonly { id: string; label: string }[];
	place: (columnId: string) => void;
	remove: () => void;
};

/**
 * Board affordances for one sidebar row: a pointer drag source (the row menu is
 * the keyboard path), its current column, and menu actions. Null when the board
 * is off or the chat has no Kilo session id yet.
 */
export function useSessionRowBoard(
	sessionId: string | undefined,
	title: string | undefined,
): SessionRowBoard | null {
	const board = useWorkspaceBoard();
	const label = title || UNTITLED_CHAT;
	const startDrag = board?.startDrag;
	const isOpen = board?.isOpen ?? false;
	const addToColumn = board?.addToColumn;
	const removeFromBoard = board?.remove;
	// Rows read only their own placement and the column names, so a card moving
	// elsewhere on the board does not re-render every row.
	const current = board && sessionId ? findSessionPlacement(board.board, sessionId) : null;
	const column = board?.board.columns.find((candidate) => candidate.id === current?.columnId);
	const placementId = column?.id;
	const placementLabel = column?.label;
	const columnsKey = JSON.stringify(
		board?.board.columns.map((entry) => [entry.id, entry.label]) ?? [],
	);
	const columns = useMemo(
		() =>
			(JSON.parse(columnsKey) as [string, string][]).map(([id, columnLabel]) => ({
				id,
				label: columnLabel,
			})),
		[columnsKey],
	);
	const onDragPointerDown = useCallback<PointerEventHandler<HTMLElement>>(
		(event) => {
			if (!sessionId || isRowControl(event.target)) return;
			startDrag?.(event, { sessionId, title: label, kind: "sidebar" });
		},
		[label, sessionId, startDrag],
	);
	const place = useCallback(
		(columnId: string) => {
			if (sessionId) addToColumn?.(sessionId, columnId);
		},
		[addToColumn, sessionId],
	);
	const remove = useCallback(() => {
		if (sessionId) removeFromBoard?.(sessionId);
	}, [removeFromBoard, sessionId]);

	const enabled = Boolean(board && sessionId);
	return useMemo(
		() =>
			enabled
				? {
						onDragPointerDown: isOpen ? onDragPointerDown : undefined,
						placement:
							placementId && placementLabel !== undefined
								? { columnId: placementId, label: placementLabel }
								: null,
						columns,
						place,
						remove,
					}
				: null,
		[columns, enabled, isOpen, onDragPointerDown, place, placementId, placementLabel, remove],
	);
}

/** The row's own buttons (archive, pin, menu) and rename field keep their pointer behaviour. */
function isRowControl(target: EventTarget): boolean {
	const control = (target as Element).closest?.("button, input");
	const isRowTrigger = control?.matches("[data-slot^='aui_session-list-'][data-slot$='-trigger']");
	return Boolean(control && !isRowTrigger);
}
