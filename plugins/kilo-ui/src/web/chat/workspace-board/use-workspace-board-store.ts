import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { toast } from "@kilo-desktop/ui/components/sonner";

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
} from "../../../contracts/workspace-board/board-model.js";
import type { WorkspaceBoardService } from "../../../contracts/workspace-board/schemas.js";

const workspaceBoardQueryKey = ["kilo-ui", "workspace-board"] as const;

/**
 * The persisted board plus optimistic mutations. Each mutation applies the same
 * pure operation main will run, synchronously, so a drop never snaps back while
 * its write is in flight. Writes can overlap (fast drags), so only the latest
 * write's response or rollback is applied, and server reads that land while any
 * write is pending keep the optimistic board; a refetch once writes settle
 * reconciles anything skipped, including writes from other windows that arrive
 * through the `workspace-board-changed` event.
 */
export function useWorkspaceBoardStore(enabled: boolean) {
	const sdk = useSdk<WorkspaceBoardService>("kilo-ui");
	const queryClient = useQueryClient();
	const writesRef = useRef({ pending: 0, latest: 0, refetchWhenSettled: false });

	const refetch = useCallback(() => {
		const writes = writesRef.current;
		if (writes.pending > 0) writes.refetchWhenSettled = true;
		else void queryClient.invalidateQueries({ queryKey: workspaceBoardQueryKey });
	}, [queryClient]);

	useEffect(() => {
		if (!enabled) return;
		return sdk.events.on("kilo-ui.workspace-board-changed", refetch);
	}, [enabled, refetch, sdk]);

	const query = useQuery({
		queryKey: workspaceBoardQueryKey,
		queryFn: async () => {
			const fetched = await sdk.client["workspaceBoard.get"]();
			if (writesRef.current.pending === 0) return fetched;
			writesRef.current.refetchWhenSettled = true;
			return queryClient.getQueryData<WorkspaceBoardState>(workspaceBoardQueryKey) ?? fetched;
		},
		enabled,
		staleTime: Number.POSITIVE_INFINITY,
	});

	const mutate = useCallback(
		(
			apply: (board: WorkspaceBoardState) => WorkspaceBoardState,
			write: () => Promise<WorkspaceBoardState>,
		) => {
			const previous =
				queryClient.getQueryData<WorkspaceBoardState>(workspaceBoardQueryKey) ??
				DEFAULT_WORKSPACE_BOARD;
			const next = apply(previous);
			if (next === previous) return;
			queryClient.setQueryData(workspaceBoardQueryKey, next);
			const writes = writesRef.current;
			const id = ++writes.latest;
			writes.pending += 1;
			const settle = (latestBoard: WorkspaceBoardState) => {
				writes.pending -= 1;
				if (id === writes.latest) queryClient.setQueryData(workspaceBoardQueryKey, latestBoard);
				else writes.refetchWhenSettled = true;
				if (writes.pending === 0 && writes.refetchWhenSettled) {
					writes.refetchWhenSettled = false;
					refetch();
				}
			};
			write().then(settle, (error: unknown) => {
				settle(previous);
				toast.error("Could not update the board", {
					description: error instanceof Error ? error.message : "Please try again.",
				});
			});
		},
		[queryClient, refetch],
	);

	const place = useCallback(
		(sessionId: string, columnId: string, index: number) =>
			mutate(
				(board) => placeSession(board, sessionId, columnId, index),
				() => sdk.client["workspaceBoard.place"]({ sessionId, columnId, index }),
			),
		[mutate, sdk],
	);

	const remove = useCallback(
		(sessionId: string) =>
			mutate(
				(board) => removeSession(board, sessionId),
				() => sdk.client["workspaceBoard.remove"]({ sessionId }),
			),
		[mutate, sdk],
	);

	const addBoardColumn = useCallback(
		(label: string) => {
			const columnId = crypto.randomUUID();
			const trimmed = label.trim();
			mutate(
				(board) => addColumn(board, columnId, trimmed),
				() => sdk.client["workspaceBoard.addColumn"]({ columnId, label: trimmed }),
			);
			return columnId;
		},
		[mutate, sdk],
	);

	const renameBoardColumn = useCallback(
		(columnId: string, label: string) => {
			const trimmed = label.trim();
			mutate(
				(board) => renameColumn(board, columnId, trimmed),
				() => sdk.client["workspaceBoard.renameColumn"]({ columnId, label: trimmed }),
			);
		},
		[mutate, sdk],
	);

	const deleteBoardColumn = useCallback(
		(columnId: string) =>
			mutate(
				(board) => deleteColumn(board, columnId),
				() => sdk.client["workspaceBoard.deleteColumn"]({ columnId }),
			),
		[mutate, sdk],
	);

	const moveBoardColumn = useCallback(
		(columnId: string, index: number) =>
			mutate(
				(board) => moveColumn(board, columnId, index),
				() => sdk.client["workspaceBoard.moveColumn"]({ columnId, index }),
			),
		[mutate, sdk],
	);

	const clear = useCallback(
		() =>
			mutate(
				(board) => clearBoard(board),
				() => sdk.client["workspaceBoard.clear"](),
			),
		[mutate, sdk],
	);

	return {
		board: query.data ?? DEFAULT_WORKSPACE_BOARD,
		clear,
		moveColumn: moveBoardColumn,
		place,
		remove,
		addColumn: addBoardColumn,
		renameColumn: renameBoardColumn,
		deleteColumn: deleteBoardColumn,
	};
}
