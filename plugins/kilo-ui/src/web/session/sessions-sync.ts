/**
 * Keeps a window's sessions store in step with main and sends this window's
 * session writes. The mirror is refetched on `sessions-changed` (coalesced, so
 * a burst of changes costs one extra list). Adoption gives chats that no
 * session owns a session of their own; `onAdopted` runs before the new links
 * are shown, so state saved under the chats' Kilo session ids can move to the
 * new sessions before anything renders under them.
 */
import {
	SESSIONS_ADOPT_MAX_CHATS,
	SESSIONS_CHANGED_EVENT,
	type SessionRecord,
	type SessionsService,
} from "../../contracts/sessions/schemas.js";
import type { KiloSessionId, SessionId } from "./session-identity.js";
import type { SessionsStore } from "./sessions-store.js";

export type SessionsSync = {
	/** Links a chat this window just created to its (possibly unsaved) session. */
	attachChat(sessionId: SessionId, kiloSessionId: KiloSessionId): void;
	adoptChats(kiloSessionIds: readonly KiloSessionId[]): void;
	deleteSession(sessionId: SessionId): void;
	/** A chat was deleted; main deletes its session too if it had no other chat. */
	detachChat(kiloSessionId: KiloSessionId): void;
	dispose(): void;
};

type Events = { on(event: string, listener: (payload: unknown) => void): () => void };

export function startSessionsSync(options: {
	store: SessionsStore;
	client: SessionsService;
	events: Events;
	onAdopted?: (adopted: Readonly<Record<KiloSessionId, SessionId>>) => void;
	log?: (message: string, error: unknown) => void;
}): SessionsSync {
	const { store, client, events } = options;
	const log = options.log ?? ((message, error) => console.warn(`[kilo-ui] ${message}`, error));
	let disposed = false;
	let refreshing = false;
	let refreshAgain = false;
	const adopting = new Set<KiloSessionId>();

	const refresh = async (): Promise<void> => {
		if (refreshing) {
			refreshAgain = true;
			return;
		}
		refreshing = true;
		try {
			do {
				refreshAgain = false;
				const { sessions } = await client["sessions.list"]();
				if (!disposed) store.replaceAll(hideChatsBeingAdopted(sessions));
			} while (refreshAgain && !disposed);
		} catch (error) {
			log("Could not load work sessions.", error);
		} finally {
			refreshing = false;
		}
	};

	// Main announces an adoption before answering it; until `onAdopted` has run,
	// chats being adopted are shown as unowned, as they were.
	const hideChatsBeingAdopted = (sessions: readonly SessionRecord[]) =>
		adopting.size === 0
			? sessions
			: sessions.map((record) => ({
					...record,
					chatIds: record.chatIds.filter((id) => !adopting.has(id)),
				}));

	const stopListening = events.on(`kilo-ui.${SESSIONS_CHANGED_EVENT}`, () => void refresh());
	void refresh();

	const adoptBatch = async (kiloSessionIds: KiloSessionId[]) => {
		try {
			const { adopted } = await client["sessions.adoptChats"]({ kiloSessionIds });
			if (disposed || Object.keys(adopted).length === 0) return;
			options.onAdopted?.(adopted);
			for (const [kiloSessionId, sessionId] of Object.entries(adopted)) {
				store.linkChat(sessionId, kiloSessionId);
				store.settleLink(kiloSessionId);
			}
		} catch (error) {
			log("Could not give chats their work sessions.", error);
		} finally {
			for (const id of kiloSessionIds) adopting.delete(id);
		}
	};

	return {
		attachChat: (sessionId, kiloSessionId) => {
			store.linkChat(sessionId, kiloSessionId);
			client["sessions.attachChat"]({ sessionId, kiloSessionId })
				.catch((error: unknown) => log("Could not save the chat's work session.", error))
				.finally(() => store.settleLink(kiloSessionId));
		},
		adoptChats: (kiloSessionIds) => {
			const { sessionIdByChat } = store.getState();
			const unowned = [...new Set(kiloSessionIds)].filter(
				(id) => !sessionIdByChat[id] && !adopting.has(id),
			);
			for (let start = 0; start < unowned.length; start += SESSIONS_ADOPT_MAX_CHATS) {
				const batch = unowned.slice(start, start + SESSIONS_ADOPT_MAX_CHATS);
				for (const id of batch) adopting.add(id);
				void adoptBatch(batch);
			}
		},
		deleteSession: (sessionId) => {
			store.dropSession(sessionId);
			client["sessions.delete"]({ sessionId }).catch((error: unknown) =>
				log("Could not delete the work session.", error),
			);
		},
		detachChat: (kiloSessionId) => {
			client["sessions.detachChat"]({ kiloSessionId }).catch((error: unknown) =>
				log("Could not unlink the deleted chat from its work session.", error),
			);
		},
		dispose: () => {
			disposed = true;
			stopListening();
		},
	};
}

/** The Kilo session id of a `session.deleted` server event, if that is what it is. */
export function deletedChatIdOf(event: {
	readonly type: string;
	readonly properties?: unknown;
}): KiloSessionId | undefined {
	if (event.type !== "session.deleted") return undefined;
	const properties = event.properties as
		| { readonly sessionID?: unknown; readonly info?: { readonly id?: unknown } }
		| undefined;
	const id = properties?.info?.id ?? properties?.sessionID;
	return typeof id === "string" && id.length > 0 ? id : undefined;
}
