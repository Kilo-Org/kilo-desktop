import type { DomainState } from "@kilo-desktop/kernel";
import type { Pane, Panes } from "@kilo-desktop/plugin-sessions/contracts";

import { TERMINAL_PANE_KIND, TERMINAL_SESSION_METADATA_KEY } from "../contracts";
import type { TerminalIdentity } from "../contracts/session";

type PanesState = DomainState<typeof Panes>;

export interface LocatedPane {
	readonly sessionId: string;
	readonly pane: Pane;
}

/** The shell a pane shows: its own id, under its session (or the one origin saved it under). */
export function terminalIdentityOf(sessionId: string, pane: Pane): TerminalIdentity {
	return {
		sessionId: pane.metadata[TERMINAL_SESSION_METADATA_KEY] ?? sessionId,
		terminalId: pane.id,
	};
}

export function terminalPanesOf(state: PanesState, sessionId: string): Pane[] {
	return (state.bySession[sessionId]?.panes ?? []).filter(
		(pane) => pane.kind === TERMINAL_PANE_KIND,
	);
}

/** The pane showing a terminal, wherever it is. */
export function locateTerminalPane(
	state: PanesState,
	identity: TerminalIdentity,
): LocatedPane | undefined {
	for (const sessionId of Object.keys(state.bySession)) {
		const pane = terminalPanesOf(state, sessionId).find(
			(candidate) =>
				candidate.id === identity.terminalId &&
				terminalIdentityOf(sessionId, candidate).sessionId === identity.sessionId,
		);
		if (pane) return { sessionId, pane };
	}
	return undefined;
}

/**
 * Every terminal pane seen, by session. Entries outlive the pane state they
 * came from until they are forgotten, so a deleted session's terminals are
 * still known when its `deleted` event arrives after its panes are gone.
 */
export class KnownTerminalPanes {
	readonly #bySession = new Map<string, Map<string, TerminalIdentity>>();

	remember(state: PanesState): void {
		for (const sessionId of Object.keys(state.bySession)) {
			for (const pane of terminalPanesOf(state, sessionId)) {
				let panes = this.#bySession.get(sessionId);
				if (!panes) this.#bySession.set(sessionId, (panes = new Map()));
				panes.set(pane.id, terminalIdentityOf(sessionId, pane));
			}
		}
	}

	forget(sessionId: string, paneId: string): void {
		this.#bySession.get(sessionId)?.delete(paneId);
	}

	/** Forgets a session, returning its terminals. */
	takeSession(sessionId: string): TerminalIdentity[] {
		const panes = this.#bySession.get(sessionId);
		this.#bySession.delete(sessionId);
		return [...(panes?.values() ?? [])];
	}
}
