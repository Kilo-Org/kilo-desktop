/**
 * Identity of a work session (a "Session"): the unit of work listed in the
 * sidebar. A session owns its panes and layout and has zero or more chats with
 * the agent, each backed by a Kilo session. Today the UI gives a session at
 * most one chat and only creates sessions through New Session; later a
 * session may hold several chats, or start from a pane with none.
 *
 * A `SessionId` is minted for the session and is never derived from a chat.
 * Which chats belong to which session is recorded by main (`sessions.*`) and
 * mirrored by the sessions store; cross between the two only through it.
 *
 * A draft is a session that is not saved yet. Its id is minted when the draft
 * is first shown and kept per assistant-ui local thread (one per draft); main
 * saves the session when the draft's first chat is attached to it.
 */

import { mintSessionId } from "../../contracts/sessions/session-id.js";

export type SessionId = string;
export type KiloSessionId = string;

let mintDraftSessionId: (localThreadId: string) => SessionId = () => mintSessionId();
const draftSessionIds = new Map<string, SessionId>();

/**
 * The draft's session id, minted on first ask. Nothing can have observed an id
 * before it exists, so minting needs no store subscription.
 */
export function draftSessionIdOf(localThreadId: string): SessionId {
	let sessionId = draftSessionIds.get(localThreadId);
	if (sessionId === undefined) {
		sessionId = mintDraftSessionId(localThreadId);
		draftSessionIds.set(localThreadId, sessionId);
	}
	return sessionId;
}

/** Makes draft ids predictable in tests; pass nothing to restore random ids. */
export function setDraftSessionIdMinterForTests(mint?: (localThreadId: string) => SessionId): void {
	draftSessionIds.clear();
	mintDraftSessionId = mint ?? (() => mintSessionId());
}

/**
 * The session an assistant-ui thread shows: its draft's until it has a chat,
 * then the session its chat is linked to. A draft whose chat was just created
 * keeps its id while the link is on its way. Undefined for a chat no session
 * is known to own yet (not loaded, or not adopted yet).
 */
export function sessionIdOfThread(
	thread: { readonly remoteId: string | undefined; readonly localThreadId: string | undefined },
	sessionIdByChat: Readonly<Record<KiloSessionId, SessionId>>,
): SessionId | undefined {
	const remoteId = thread.remoteId?.trim();
	const localThreadId = thread.localThreadId?.trim() ?? "";
	if (!remoteId) return draftSessionIdOf(localThreadId);
	return sessionIdByChat[remoteId] ?? draftSessionIds.get(localThreadId);
}
