import { createContext, useContext, useLayoutEffect } from "react";

import type { Pane } from "@kilo-desktop/plugin-sessions/contracts";

/** Asks the person whether a pane may close; true closes it. */
export type CloseGuard = () => Promise<boolean>;

const key = (sessionId: string, paneId: string) => `${sessionId}\u0000${paneId}`;

/**
 * The window's mounted Notebook panes with unsaved notebooks, by session and
 * pane. A pane registers a guard while its notebook is dirty; kilo.workbench
 * asks the pane kind's `canClose` before closing a pane, which consults the
 * guard (a pane with nothing registered closes at once). Notebook panes are
 * kept alive, so every pane the window shows is mounted.
 */
export class CloseGuards {
	readonly #guards = new Map<string, CloseGuard>();

	register(sessionId: string, paneId: string, guard: CloseGuard): () => void {
		const id = key(sessionId, paneId);
		this.#guards.set(id, guard);
		return () => {
			if (this.#guards.get(id) === guard) this.#guards.delete(id);
		};
	}

	canClose = ({ sessionId, pane }: { sessionId: string; pane: Pane }): Promise<boolean> =>
		this.#guards.get(key(sessionId, pane.id))?.() ?? Promise.resolve(true);
}

export const CloseGuardsContext = createContext<CloseGuards | null>(null);

/** Registers `guard` for the pane while it is non-null. */
export function useCloseGuard(sessionId: string, paneId: string, guard: CloseGuard | null): void {
	const guards = useContext(CloseGuardsContext);
	useLayoutEffect(() => {
		if (!guards || !guard) return;
		return guards.register(sessionId, paneId, guard);
	}, [guard, guards, paneId, sessionId]);
}
