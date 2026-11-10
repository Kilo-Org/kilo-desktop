import { createContext, useContext, useLayoutEffect } from "react";

import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

/** Asks the person whether a pane may close; true closes it. */
export type CloseGuard = () => Promise<boolean>;

export interface CloseRequest {
	readonly resolve: (close: boolean) => void;
}

const key = (workSessionId: string, paneId: string) => `${workSessionId}\u0000${paneId}`;

/**
 * The window's mounted Files panes with unsaved changes, by session and pane.
 * A pane registers a guard while it is dirty; kilo.work-sessions asks the pane
 * kind's `canClose` before closing a pane, which consults the guard (a pane
 * with nothing registered closes at once). Panes that aren't kept alive
 * unmount while hidden, so only shown panes can hold unsaved edits.
 */
export class CloseGuards {
	readonly #guards = new Map<string, CloseGuard>();

	register(workSessionId: string, paneId: string, guard: CloseGuard): () => void {
		const id = key(workSessionId, paneId);
		this.#guards.set(id, guard);
		return () => {
			if (this.#guards.get(id) === guard) this.#guards.delete(id);
		};
	}

	canClose = ({ workSessionId, pane }: { workSessionId: string; pane: Pane }): Promise<boolean> =>
		this.#guards.get(key(workSessionId, pane.id))?.() ?? Promise.resolve(true);
}

export const CloseGuardsContext = createContext<CloseGuards | null>(null);

/** Registers `guard` for the pane while it is non-null, from the commit that shows the unsaved state. */
export function useCloseGuard(
	workSessionId: string,
	paneId: string,
	guard: CloseGuard | null,
): void {
	const guards = useContext(CloseGuardsContext);
	useLayoutEffect(() => {
		if (!guards || !guard) return;
		return guards.register(workSessionId, paneId, guard);
	}, [guard, guards, paneId, workSessionId]);
}
