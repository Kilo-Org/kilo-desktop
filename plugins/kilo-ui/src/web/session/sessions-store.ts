/**
 * This window's mirror of the work sessions main saves (`sessions.*`): each
 * session and the chats linked to it, indexed both ways. Main is the single
 * writer; the mirror is replaced from `sessions.list` and patched
 * optimistically by this window's own writes. An optimistic link is kept
 * across replacements until its write settles, so a list fetched before the
 * write landed cannot briefly unlink a chat that was just created.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

import type { SessionRecord } from "../../contracts/sessions/schemas.js";
import type { KiloSessionId, SessionId } from "./session-identity.js";

export type SessionsState = {
	/** False until the first list arrives; until then no chat's session is known. */
	readonly loaded: boolean;
	readonly sessions: Readonly<Record<SessionId, SessionRecord>>;
	readonly sessionIdByChat: Readonly<Record<KiloSessionId, SessionId>>;
	readonly pendingLinks: Readonly<Record<KiloSessionId, SessionId>>;
};

export type SessionsStore = StoreApi<SessionsState> & {
	replaceAll(sessions: readonly SessionRecord[]): void;
	/** Optimistically links a chat; `settleLink` ends the optimism once main has it. */
	linkChat(sessionId: SessionId, kiloSessionId: KiloSessionId): void;
	settleLink(kiloSessionId: KiloSessionId): void;
	dropSession(sessionId: SessionId): void;
};

function index(
	records: Iterable<SessionRecord>,
	pendingLinks: Readonly<Record<KiloSessionId, SessionId>>,
): Pick<SessionsState, "sessions" | "sessionIdByChat"> {
	const sessions: Record<SessionId, SessionRecord> = {};
	for (const record of records)
		sessions[record.id] = { id: record.id, chatIds: [...record.chatIds] };
	for (const [kiloSessionId, sessionId] of Object.entries(pendingLinks)) {
		for (const record of Object.values(sessions)) {
			if (record.id !== sessionId && record.chatIds.includes(kiloSessionId)) {
				record.chatIds = record.chatIds.filter((id) => id !== kiloSessionId);
			}
		}
		const record = (sessions[sessionId] ??= { id: sessionId, chatIds: [] });
		if (!record.chatIds.includes(kiloSessionId))
			record.chatIds = [...record.chatIds, kiloSessionId];
	}
	const sessionIdByChat: Record<KiloSessionId, SessionId> = {};
	for (const record of Object.values(sessions)) {
		for (const kiloSessionId of record.chatIds) sessionIdByChat[kiloSessionId] = record.id;
	}
	return { sessions, sessionIdByChat };
}

export function createSessionsStore(initial?: readonly SessionRecord[]): SessionsStore {
	const store = createStore<SessionsState>(() => ({
		loaded: initial !== undefined,
		...index(initial ?? [], {}),
		pendingLinks: {},
	}));
	const reindex = (records: Iterable<SessionRecord>, pendingLinks: SessionsState["pendingLinks"]) =>
		store.setState({ ...index(records, pendingLinks), pendingLinks });

	return {
		...store,
		replaceAll: (sessions) => {
			store.setState({ loaded: true });
			reindex(sessions, store.getState().pendingLinks);
		},
		linkChat: (sessionId, kiloSessionId) => {
			const state = store.getState();
			if (
				state.sessionIdByChat[kiloSessionId] === sessionId &&
				!state.pendingLinks[kiloSessionId]
			) {
				return;
			}
			reindex(Object.values(state.sessions), { ...state.pendingLinks, [kiloSessionId]: sessionId });
		},
		settleLink: (kiloSessionId) => {
			const state = store.getState();
			if (!(kiloSessionId in state.pendingLinks)) return;
			const { [kiloSessionId]: _settled, ...pendingLinks } = state.pendingLinks;
			// The link stays in the mirror; only its protection from stale lists ends.
			store.setState({ pendingLinks });
		},
		dropSession: (sessionId) => {
			const state = store.getState();
			if (!state.sessions[sessionId]) return;
			const { [sessionId]: _dropped, ...sessions } = state.sessions;
			const pendingLinks = Object.fromEntries(
				Object.entries(state.pendingLinks).filter(([, id]) => id !== sessionId),
			);
			reindex(Object.values(sessions), pendingLinks);
		},
	};
}
