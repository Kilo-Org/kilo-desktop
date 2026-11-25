import { historyPageInput, type KiloClient } from "@kilo-desktop/react-opencode-v2";

/*
 * Chat histories loaded ahead of opening (a work session's row hovered), kept
 * until the chat's transcript loads or briefly otherwise. A chat's thread
 * loads its history with `session.get` and `message.list`, a page at a
 * time; a client made by `withPrefetchedHistory` answers the first of those
 * from here, so the transcript shows without a round trip. (Any later pages
 * of a long history are not prefetched.)
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
				["messages", client.message.list(historyPageInput(chatId))],
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
 * its id, `message.list` for the first page of its history) are answered
 * from `prefetch` when it holds a current reply.
 */
export function withPrefetchedHistory(
	client: KiloClient,
	chatId: string,
	prefetch: HistoryPrefetch,
): KiloClient {
	const expected: Record<HistoryReply, Record<string, unknown>> = {
		get: { sessionID: chatId },
		messages: historyPageInput(chatId),
	};
	const isHistoryRead = (kind: HistoryReply, parameters: unknown) => {
		const record = parameters as Record<string, unknown> | undefined;
		if (record?.["sessionID"] !== chatId) return false;
		const keys = Object.keys(record);
		return (
			keys.length === Object.keys(expected[kind]).length &&
			keys.every((key) => record[key] === expected[kind][key])
		);
	};
	/** `group` (`session` or `message`) with its `method` answered from the prefetch. */
	const answering = (group: object, method: PropertyKey, kind: HistoryReply) =>
		new Proxy(group, {
			get(target, prop, receiver) {
				const value = Reflect.get(target, prop, receiver);
				if (prop !== method || typeof value !== "function") return value;
				return (...args: unknown[]) =>
					(isHistoryRead(kind, args[0]) ? prefetch.take(chatId, kind) : undefined) ??
					Reflect.apply(value, target, args);
			},
		});
	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (value === null || typeof value !== "object") return value;
			if (prop === "session") return answering(value, "get", "get");
			if (prop === "message") return answering(value, "list", "messages");
			return value;
		},
	}) as KiloClient;
}
