import type { PaneDirection } from "@kilo-desktop/pane-layout";

/** A tab command's request to move a pane one step, for the canvas showing its work session. */
export interface PaneMoveRequest {
	readonly workSessionId: string;
	readonly paneId: string;
	readonly direction: PaneDirection;
}

/** What `PaneCanvas` listens to for moves; the host filters it to its work session. */
export interface PaneMoveRequests {
	readonly subscribe: (
		listener: (request: Pick<PaneMoveRequest, "paneId" | "direction">) => void,
	) => () => void;
}

const listeners = new Set<(request: PaneMoveRequest) => void>();

/**
 * Moves asked for in this window. The canvas carries them out rather than the
 * command saving a layout itself: it parks the moved panes' content (so
 * iframes and terminals survive the move) and holds the unsaved layout a
 * drag may have left.
 */
export const paneMoves = {
	request(request: PaneMoveRequest): void {
		for (const listener of listeners) listener(request);
	},
	forWorkSession(workSessionId: string): PaneMoveRequests {
		return {
			subscribe(listener) {
				const filtered = (request: PaneMoveRequest) => {
					if (request.workSessionId === workSessionId) listener(request);
				};
				listeners.add(filtered);
				return () => listeners.delete(filtered);
			},
		};
	},
};
