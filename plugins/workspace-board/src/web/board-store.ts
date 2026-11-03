import { useSyncExternalStore } from "react";

import type { DomainHandle, PluginSdk } from "@kilo-desktop/kernel";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	addColumn,
	Board,
	BOARD_MAX_COLUMNS,
	clearBoard,
	DEFAULT_BOARD,
	deleteColumn,
	findSessionPlacement,
	moveColumn,
	placeSession,
	removeSession,
	renameColumn,
	type BoardState,
} from "../contracts";

/** Placing at the largest index puts a card at the end of its column. */
export const END_OF_COLUMN = Number.MAX_SAFE_INTEGER;

export interface BoardStore {
	/** The board this window shows: its own pending changes over the saved board. */
	snapshot(): BoardState;
	subscribe(listener: () => void): () => void;
	/** False while kilo.workspace-board's main entry is not there (browser mode). */
	available(): boolean;
	place(sessionId: string, columnId: string, index?: number): void;
	remove(sessionId: string): void;
	clear(): void;
	/** Appends a column and returns its id; null when the board has the most columns it may. */
	addColumn(label: string): string | null;
	renameColumn(columnId: string, label: string): void;
	moveColumn(columnId: string, index: number): void;
	deleteColumn(columnId: string): void;
}

type BoardHandle = DomainHandle<typeof Board>;

/**
 * The window's view of `kilo.workspace-board/board` with optimistic changes. A change
 * applies the same pure operation main runs at once, so a drop never snaps
 * back while its call is in flight. Changes can overlap (fast drags); the
 * optimistic board stays until every call has settled and the saved board
 * has reached the newest revision they returned. A failed change toasts and
 * falls back to the saved board.
 */
export function createBoardStore(
	sdk: PluginSdk,
	createId: () => string = () => crypto.randomUUID(),
): BoardStore {
	const listeners = new Set<() => void>();
	let optimistic: BoardState | null = null;
	let pending = 0;
	let awaitedRevision = 0;
	let failed = false;

	const handle = (): BoardHandle | null => sdk.domains.get(Board);
	const saved = () => handle()?.getState();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const settle = () => {
		if (pending > 0 || optimistic === null) return;
		if (failed || (saved()?.revision ?? 0) >= awaitedRevision) {
			failed = false;
			optimistic = null;
		}
	};

	let stopFollowing: (() => void) | undefined;
	sdk.domains.track(Board, {
		added(board) {
			stopFollowing = board.subscribe(() => {
				settle();
				notify();
			});
			notify();
		},
		removed() {
			stopFollowing?.();
			optimistic = null;
			notify();
		},
	});
	sdk.onDispose(() => stopFollowing?.());

	const snapshot = (): BoardState => optimistic ?? saved()?.board ?? DEFAULT_BOARD;

	function mutate(
		apply: (board: BoardState) => BoardState,
		call: (board: BoardHandle) => Promise<number>,
	): void {
		const board = handle();
		if (!board) return;
		const before = snapshot();
		const next = apply(before);
		if (next === before) return;
		optimistic = next;
		pending += 1;
		notify();
		call(board)
			.then(
				(revision) => {
					awaitedRevision = Math.max(awaitedRevision, revision);
				},
				(error: unknown) => {
					failed = true;
					toast.error("Could not update the board", {
						description: error instanceof Error ? error.message : "Please try again.",
					});
				},
			)
			.finally(() => {
				pending -= 1;
				settle();
				notify();
			});
	}

	return {
		snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		available: () => handle() !== null,
		place(sessionId, columnId, index = END_OF_COLUMN) {
			mutate(
				(board) => placeSession(board, sessionId, columnId, index),
				(board) => board.methods.place({ sessionId, columnId, index }),
			);
		},
		remove(sessionId) {
			if (!findSessionPlacement(snapshot(), sessionId)) return;
			mutate(
				(board) => removeSession(board, sessionId),
				(board) => board.methods.remove({ sessionId }),
			);
		},
		clear() {
			mutate(clearBoard, (board) => board.methods.clear(undefined));
		},
		addColumn(label) {
			if (!handle() || snapshot().columns.length >= BOARD_MAX_COLUMNS) return null;
			const columnId = createId();
			const trimmed = label.trim();
			mutate(
				(board) => addColumn(board, columnId, trimmed),
				(board) => board.methods.addColumn({ columnId, label: trimmed }),
			);
			return columnId;
		},
		renameColumn(columnId, label) {
			const trimmed = label.trim();
			mutate(
				(board) => renameColumn(board, columnId, trimmed),
				(board) => board.methods.renameColumn({ columnId, label: trimmed }),
			);
		},
		moveColumn(columnId, index) {
			mutate(
				(board) => moveColumn(board, columnId, index),
				(board) => board.methods.moveColumn({ columnId, index }),
			);
		},
		deleteColumn(columnId) {
			mutate(
				(board) => deleteColumn(board, columnId),
				(board) => board.methods.deleteColumn({ columnId }),
			);
		},
	};
}

let current: BoardStore | null = null;

/** The window's board store, set when kilo.workspace-board activates here. */
export function setBoardStore(store: BoardStore): void {
	current = store;
}

export function boardStore(): BoardStore {
	if (!current) throw new Error("kilo.workspace-board is not active in this window.");
	return current;
}

export function useBoardState(): BoardState {
	const store = boardStore();
	return useSyncExternalStore(store.subscribe, store.snapshot);
}
