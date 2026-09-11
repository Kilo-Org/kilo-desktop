import type { TerminalIdentity } from "../contracts/session.js";

export interface TerminalPaneOwner {
	readonly paneSessionId: string;
	readonly terminalSessionId: string;
	readonly terminalId: string;
}

/**
 * Tracks the renderer-local pane that owns each main-process terminal session.
 * Terminal backend identities survive Kilo's draft-to-remote session promotion,
 * while pane session identities can change; registrations therefore replace the
 * current owner atomically and only their matching cleanup may remove it.
 */
const owners = new Map<string, TerminalPaneOwner>();

export function registerTerminalPaneOwner(owner: TerminalPaneOwner): () => void {
	const key = terminalIdentityKey({
		sessionId: owner.terminalSessionId,
		terminalId: owner.terminalId,
	});
	owners.set(key, owner);
	return () => {
		if (owners.get(key) === owner) owners.delete(key);
	};
}

export function getTerminalPaneOwner(identity: TerminalIdentity): TerminalPaneOwner | undefined {
	return owners.get(terminalIdentityKey(identity));
}

export function terminalIdentityKey(identity: TerminalIdentity): string {
	return `${identity.sessionId}\0${identity.terminalId}`;
}
