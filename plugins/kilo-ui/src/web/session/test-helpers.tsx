import { useAuiState } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";

import type { SessionRecord, SessionsService } from "../../contracts/sessions/schemas.js";
import type { KiloSessionId, SessionId } from "./session-identity.js";
import { SessionsProvider } from "./SessionsProvider.js";
import { createSessionsStore } from "./sessions-store.js";

/** Loaded work sessions for component tests: each listed chat linked to its session. */
export function SessionsFixture({
	chats,
	children,
}: {
	chats: Readonly<Record<KiloSessionId, SessionId>>;
	children: ReactNode;
}) {
	const store = useMemo(
		() =>
			createSessionsStore(
				Object.entries(chats).map(([kiloSessionId, id]) => ({ id, chatIds: [kiloSessionId] })),
			),
		[chats],
	);
	return (
		<SessionsProvider store={store} sync={null}>
			{children}
		</SessionsProvider>
	);
}

/**
 * Gives every chat in the thread list a session with the chat's own id, so
 * list and board assertions can name rows by their chat. Must render inside
 * an `AssistantRuntimeProvider`.
 */
export function SessionPerChatFixture({ children }: { children: ReactNode }) {
	const remoteIds = useAuiState((state) =>
		state.threads.threadItems.flatMap((item) => (item.remoteId ? [item.remoteId] : [])).join("\n"),
	);
	const chats = useMemo(
		() =>
			Object.fromEntries(
				remoteIds
					.split("\n")
					.filter(Boolean)
					.map((id) => [id, id]),
			),
		[remoteIds],
	);
	return <SessionsFixture chats={chats}>{children}</SessionsFixture>;
}

/**
 * An in-memory stand-in for main's `sessions.*` handlers. Like main, every
 * change is announced (through `announceWith`, once a test wires it to its
 * events) before the handler answers. `link` saves a session for a chat as if
 * another window had.
 */
export function createFakeSessionsBackend() {
	const sessions = new Map<SessionId, KiloSessionId[]>();
	let nextId = 0;
	let announce: () => void = () => undefined;
	const records = (): SessionRecord[] =>
		[...sessions].map(([id, chatIds]) => ({ id, chatIds: [...chatIds] }));
	const attach = (sessionId: SessionId, kiloSessionId: KiloSessionId) => {
		for (const [id, chatIds] of sessions) {
			sessions.set(
				id,
				chatIds.filter((chatId) => chatId !== kiloSessionId),
			);
		}
		sessions.set(sessionId, [...(sessions.get(sessionId) ?? []), kiloSessionId]);
	};
	const handlers: SessionsService = {
		"sessions.list": async () => ({ sessions: records() }),
		"sessions.attachChat": async ({ sessionId, kiloSessionId }) => {
			attach(sessionId, kiloSessionId);
			announce();
			return { id: sessionId, chatIds: sessions.get(sessionId) ?? [] };
		},
		"sessions.adoptChats": async ({ kiloSessionIds }) => {
			const owned = new Set([...sessions.values()].flat());
			const adopted: Record<KiloSessionId, SessionId> = {};
			for (const kiloSessionId of kiloSessionIds) {
				if (owned.has(kiloSessionId)) continue;
				const sessionId = `wses_adopted_${++nextId}`;
				attach(sessionId, kiloSessionId);
				adopted[kiloSessionId] = sessionId;
			}
			if (Object.keys(adopted).length > 0) announce();
			return { adopted };
		},
		"sessions.delete": async ({ sessionId }) => {
			const deleted = sessions.delete(sessionId);
			if (deleted) announce();
			return { deleted };
		},
		"sessions.detachChat": async ({ kiloSessionId }) => {
			for (const [id, chatIds] of sessions) {
				if (!chatIds.includes(kiloSessionId)) continue;
				const remaining = chatIds.filter((chatId) => chatId !== kiloSessionId);
				if (remaining.length > 0) sessions.set(id, remaining);
				else sessions.delete(id);
				announce();
				return { deletedSessionId: remaining.length > 0 ? null : id };
			}
			return { deletedSessionId: null };
		},
	};
	return {
		handlers,
		records,
		link: (sessionId: SessionId, kiloSessionId: KiloSessionId) => {
			attach(sessionId, kiloSessionId);
			announce();
		},
		reset: () => {
			sessions.clear();
			nextId = 0;
			announce = () => undefined;
		},
		announceWith: (next: () => void) => {
			announce = next;
		},
	};
}
