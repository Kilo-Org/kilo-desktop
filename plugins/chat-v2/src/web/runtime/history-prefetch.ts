import { OPEN_CODE_HISTORY_PAGE_SIZE } from "@kilo-desktop/react-opencode-v2";
import type { KiloClient } from "@kilocode/sdk/v2/client";

/*
 * Chat histories loaded ahead of opening (a work session's row hovered), kept
 * until the chat's transcript loads or briefly otherwise. A chat's thread
 * loads its history with `session.get` and the newest page of
 * `session.messages`; a client made by `withPrefetchedHistory` answers those
 * from here, so the transcript shows without a round trip. (The older
 * messages the thread fetches next are not prefetched.)
 *
 * - An entry is only served while it is current: any event for its chat
 *   drops it (its replies may be missing what the event brought), as does its
 *   time running out. A dropped or failed entry just means the thread loads
 *   normally.
 * - Each reply is served once: a later load (a resync, a reopen) is the
 *   thread asking for what is current now.
 */

/** How long a prefetched history waits to be opened. */
export const PREFETCH_TTL_MS = 30_000;

type HistoryReply = "get" | "messages";

interface Entry {
	readonly replies: Map<HistoryReply, Promise<unknown>>;
	readonly expires: number;
}

export class HistoryPrefetch {
	readonly #entries = new Map<string, Entry>();

	/** Loads `chatId`'s history through `client`, unless it is already waiting. */
	prefetch(chatId: string, client: KiloClient): void {
		const existing = this.#entries.get(chatId);
		if (existing && existing.expires > Date.now()) return;
		const entry: Entry = {
			replies: new Map<HistoryReply, Promise<unknown>>([
				["get", client.session.get({ sessionID: chatId })],
				[
					"messages",
					client.session.messages({ sessionID: chatId, limit: OPEN_CODE_HISTORY_PAGE_SIZE }),
				],
			]),
			expires: Date.now() + PREFETCH_TTL_MS,
		};
		this.#entries.set(chatId, entry);
		// A failure is the opening thread's to report, when it loads again.
		for (const reply of entry.replies.values()) {
			reply.catch(() => {
				if (this.#entries.get(chatId) === entry) this.#entries.delete(chatId);
			});
		}
	}

	/** Drops `chatId`'s prefetched history: something about the chat changed. */
	invalidate(chatId: string | undefined): void {
		if (chatId) this.#entries.delete(chatId);
	}

	/** `chatId`'s prefetched `kind` reply, once, while it is current. */
	take(chatId: string, kind: HistoryReply): Promise<unknown> | undefined {
		const entry = this.#entries.get(chatId);
		if (!entry) return undefined;
		if (entry.expires <= Date.now()) {
			this.#entries.delete(chatId);
			return undefined;
		}
		const reply = entry.replies.get(kind);
		entry.replies.delete(kind);
		if (entry.replies.size === 0) this.#entries.delete(chatId);
		return reply;
	}

	clear(): void {
		this.#entries.clear();
	}
}

/**
 * `client`, whose plain history reads for `chatId` (`session.get` with only
 * its id, `session.messages` for its newest page) are answered from
 * `prefetch` when it holds a current reply.
 */
export function withPrefetchedHistory(
	client: KiloClient,
	chatId: string,
	prefetch: HistoryPrefetch,
): KiloClient {
	const isHistoryRead = (kind: HistoryReply, parameters: unknown) => {
		const record = parameters as Record<string, unknown> | undefined;
		if (record?.["sessionID"] !== chatId) return false;
		const expected: Record<string, unknown> =
			kind === "get"
				? { sessionID: chatId }
				: { sessionID: chatId, limit: OPEN_CODE_HISTORY_PAGE_SIZE };
		const keys = Object.keys(record);
		return (
			keys.length === Object.keys(expected).length &&
			keys.every((key) => record[key] === expected[key])
		);
	};
	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop !== "session" || value === null || typeof value !== "object") return value;
			return new Proxy(value as object, {
				get(sessionTarget, sessionProp, sessionReceiver) {
					const method = Reflect.get(sessionTarget, sessionProp, sessionReceiver);
					if (
						(sessionProp !== "get" && sessionProp !== "messages") ||
						typeof method !== "function"
					) {
						return method;
					}
					return (...args: unknown[]) =>
						(isHistoryRead(sessionProp, args[0])
							? prefetch.take(chatId, sessionProp)
							: undefined) ?? Reflect.apply(method, sessionTarget, args);
				},
			});
		},
	}) as KiloClient;
}
