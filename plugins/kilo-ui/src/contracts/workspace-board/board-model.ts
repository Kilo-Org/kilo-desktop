/**
 * Pure workspace-board operations shared by the main-process store (the source of
 * truth) and the renderer (optimistic updates and drag previews), so both sides
 * always agree on where a card lands. Cards are Kilo session ids; each id appears
 * in at most one column. Operations return the input reference when nothing
 * changes so callers can skip redundant writes and re-renders.
 */
import {
	WORKSPACE_BOARD_MAX_COLUMNS,
	type WorkspaceBoardColumn,
	type WorkspaceBoardState,
} from "./schemas.js";

export type { WorkspaceBoardState };

type SessionPlacement = { columnId: string; index: number };

export const DEFAULT_WORKSPACE_BOARD: WorkspaceBoardState = {
	columns: [
		{ id: "backlog", label: "Backlog", sessionIds: [] },
		{ id: "in-progress", label: "In progress", sessionIds: [] },
		{ id: "review", label: "Review", sessionIds: [] },
		{ id: "done", label: "Done", sessionIds: [] },
	],
};

export function findSessionPlacement(
	state: WorkspaceBoardState,
	sessionId: string,
): SessionPlacement | null {
	for (const column of state.columns) {
		const index = column.sessionIds.indexOf(sessionId);
		if (index >= 0) return { columnId: column.id, index };
	}
	return null;
}

export function placeSession(
	state: WorkspaceBoardState,
	sessionId: string,
	columnId: string,
	index: number,
): WorkspaceBoardState {
	const target = state.columns.find((column) => column.id === columnId);
	if (!target) return state;
	const current = findSessionPlacement(state, sessionId);
	const remaining = target.sessionIds.filter((id) => id !== sessionId);
	const clamped = Math.min(Math.max(0, Math.trunc(index)), remaining.length);
	if (current?.columnId === columnId && current.index === clamped) return state;
	return {
		columns: state.columns.map((column) => {
			if (column.id === columnId) {
				return {
					...column,
					sessionIds: [...remaining.slice(0, clamped), sessionId, ...remaining.slice(clamped)],
				};
			}
			if (column.id === current?.columnId) {
				return { ...column, sessionIds: column.sessionIds.filter((id) => id !== sessionId) };
			}
			return column;
		}),
	};
}

export function removeSession(state: WorkspaceBoardState, sessionId: string): WorkspaceBoardState {
	const current = findSessionPlacement(state, sessionId);
	if (!current) return state;
	return {
		columns: state.columns.map((column) =>
			column.id === current.columnId
				? { ...column, sessionIds: column.sessionIds.filter((id) => id !== sessionId) }
				: column,
		),
	};
}

/** Re-keys cards whose session id changed, keeping their places; ids already on the board win. */
export function renameSessions(
	state: WorkspaceBoardState,
	renames: Readonly<Record<string, string>>,
): WorkspaceBoardState {
	const onBoard = new Set(state.columns.flatMap((column) => column.sessionIds));
	let changed = false;
	const columns = state.columns.map((column) => {
		const sessionIds = column.sessionIds.flatMap((id) => {
			const renamed = renames[id];
			if (renamed === undefined || renamed === id) return [id];
			changed = true;
			return onBoard.has(renamed) ? [] : [renamed];
		});
		return sessionIds.length === column.sessionIds.length &&
			sessionIds.every((id, index) => id === column.sessionIds[index])
			? column
			: { ...column, sessionIds };
	});
	return changed ? { columns } : state;
}

export function addColumn(
	state: WorkspaceBoardState,
	columnId: string,
	label: string,
): WorkspaceBoardState {
	const full = state.columns.length >= WORKSPACE_BOARD_MAX_COLUMNS;
	if (full || state.columns.some((column) => column.id === columnId)) return state;
	return { columns: [...state.columns, { id: columnId, label, sessionIds: [] }] };
}

export function renameColumn(
	state: WorkspaceBoardState,
	columnId: string,
	label: string,
): WorkspaceBoardState {
	const column = state.columns.find((candidate) => candidate.id === columnId);
	if (!column || column.label === label) return state;
	return {
		columns: state.columns.map((candidate) =>
			candidate.id === columnId ? { ...candidate, label } : candidate,
		),
	};
}

/** The next column, or the previous one for the last column; null when nothing can receive the cards. */
export function deletedColumnDestination(
	state: WorkspaceBoardState,
	columnId: string,
): WorkspaceBoardColumn | null {
	const index = state.columns.findIndex((column) => column.id === columnId);
	if (index < 0) return null;
	return state.columns[index + 1] ?? state.columns[index - 1] ?? null;
}

/** Cards are never dropped with a column: they move to the end of its neighbour. */
export function deleteColumn(state: WorkspaceBoardState, columnId: string): WorkspaceBoardState {
	const destination = deletedColumnDestination(state, columnId);
	const deleted = state.columns.find((column) => column.id === columnId);
	if (!destination || !deleted) return state;
	return {
		columns: state.columns.flatMap((column) => {
			if (column.id === columnId) return [];
			if (column.id === destination.id) {
				return [{ ...column, sessionIds: [...column.sessionIds, ...deleted.sessionIds] }];
			}
			return [column];
		}),
	};
}

/** Moves a column so it ends at `index` (clamped); its cards move with it. */
export function moveColumn(
	state: WorkspaceBoardState,
	columnId: string,
	index: number,
): WorkspaceBoardState {
	const current = state.columns.findIndex((column) => column.id === columnId);
	if (current < 0) return state;
	const remaining = state.columns.filter((column) => column.id !== columnId);
	const clamped = Math.min(Math.max(0, Math.trunc(index)), remaining.length);
	if (clamped === current) return state;
	return {
		columns: [...remaining.slice(0, clamped), state.columns[current]!, ...remaining.slice(clamped)],
	};
}

/** Takes every card off the board; the columns, their names and order stay. */
export function clearBoard(state: WorkspaceBoardState): WorkspaceBoardState {
	if (state.columns.every((column) => column.sessionIds.length === 0)) return state;
	return { columns: state.columns.map((column) => ({ ...column, sessionIds: [] })) };
}
