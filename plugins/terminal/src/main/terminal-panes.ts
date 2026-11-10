import type { DomainObjectState } from "@kilo-desktop/kernel";
import type { Pane, Panes } from "@kilo-desktop/plugin-work-sessions/contracts";

import { TERMINAL_PANE_KIND, TERMINAL_SESSION_METADATA_KEY } from "../contracts";
import type { TerminalIdentity } from "../contracts/session";

type PanesState = DomainObjectState<typeof Panes>;

export interface LocatedPane {
	readonly workSessionId: string;
	readonly pane: Pane;
}

/** The shell a pane shows: its own id, under its work session (or the one origin saved it under). */
export function terminalIdentityOf(workSessionId: string, pane: Pane): TerminalIdentity {
	return {
		sessionId: pane.metadata[TERMINAL_SESSION_METADATA_KEY] ?? workSessionId,
		terminalId: pane.id,
	};
}

export function terminalPanesOf(state: PanesState, workSessionId: string): Pane[] {
	return (state.byWorkSession[workSessionId]?.panes ?? []).filter(
		(pane) => pane.kind === TERMINAL_PANE_KIND,
	);
}

/** The pane showing a terminal, wherever it is. */
export function locateTerminalPane(
	state: PanesState,
	identity: TerminalIdentity,
): LocatedPane | undefined {
	for (const workSessionId of Object.keys(state.byWorkSession)) {
		const pane = terminalPanesOf(state, workSessionId).find(
			(candidate) =>
				candidate.id === identity.terminalId &&
				terminalIdentityOf(workSessionId, candidate).sessionId === identity.sessionId,
		);
		if (pane) return { workSessionId, pane };
	}
	return undefined;
}

/**
 * Every terminal pane seen, by work session. Entries outlive the pane state
 * they came from until they are forgotten, so a deleted work session's
 * terminals are still known when its `deleted` event arrives after its panes
 * are gone.
 */
export class KnownTerminalPanes {
	readonly #byWorkSession = new Map<string, Map<string, TerminalIdentity>>();

	remember(state: PanesState): void {
		for (const workSessionId of Object.keys(state.byWorkSession)) {
			for (const pane of terminalPanesOf(state, workSessionId)) {
				let panes = this.#byWorkSession.get(workSessionId);
				if (!panes) this.#byWorkSession.set(workSessionId, (panes = new Map()));
				panes.set(pane.id, terminalIdentityOf(workSessionId, pane));
			}
		}
	}

	forget(workSessionId: string, paneId: string): void {
		this.#byWorkSession.get(workSessionId)?.delete(paneId);
	}

	/** Forgets a work session, returning its terminals. */
	takeWorkSession(workSessionId: string): TerminalIdentity[] {
		const panes = this.#byWorkSession.get(workSessionId);
		this.#byWorkSession.delete(workSessionId);
		return [...(panes?.values() ?? [])];
	}
}
