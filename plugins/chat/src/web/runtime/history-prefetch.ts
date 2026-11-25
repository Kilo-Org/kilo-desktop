import { OPEN_CODE_HISTORY_PAGE_SIZE } from "@kilo-desktop/react-opencode";
import type { OpenCodeClient } from "@kilocode/client";

import { overrideMethod } from "./override-method";

/*
 * Chat histories loaded ahead of opening (a work session's row hovered), kept
 * until the chat's transcript loads or briefly otherwise. A chat's thread
 * loads its history with `session.get` and the newest page of
 * `message.list`; a client made by `withPrefetchedHistory` answers those
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

type HistoryReply = "get" | "list";

interface Entry {
	readonly replies: Map<HistoryReply, Promise<unknown>>;
	readonly expires: number;
}

export class HistoryPrefetch {
	readonly #entries = new Map<string, Entry>();

	/** Loads `chatId`'s history through `client`, unless it is already waiting. */
	prefetch(chatId: string, client: OpenCodeClient): void {
		const existing = this.#entries.get(chatId);
		if (existing && existing.expires > Date.now()) return;
		const entry: Entry = {
			replies: new Map<HistoryReply, Promise<unknown>>([
				["get", client.session.get({ sessionID: chatId })],
				["list", client.message.list({ sessionID: chatId, limit: OPEN_CODE_HISTORY_PAGE_SIZE })],
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

/** Whether `input` is exactly `expected`: a thread's plain first history read. */
function isExactly(input: unknown, expected: Record<string, unknown>): boolean {
	if (typeof input !== "object" || input === null) return false;
	const record = input as Record<string, unknown>;
	const keys = Object.keys(record);
	return (
		keys.length === Object.keys(expected).length &&
		keys.every((key) => record[key] === expected[key])
	);
}

const sessionOf = (input: unknown) => (input as { sessionID?: unknown } | null)?.sessionID;

/**
 * `client`, whose plain history reads (`session.get` with only the session's
 * id, `message.list` for its newest page) are answered from `prefetch` when
 * it holds a current reply for that session.
 */
export function withPrefetchedHistory(
	client: OpenCodeClient,
	prefetch: HistoryPrefetch,
): OpenCodeClient {
	const served =
		(kind: HistoryReply, expected: (chatId: string) => Record<string, unknown>) =>
		(original: (...args: unknown[]) => unknown) =>
		(input: unknown, ...rest: unknown[]) => {
			const chatId = sessionOf(input);
			const reply =
				typeof chatId === "string" && isExactly(input, expected(chatId))
					? prefetch.take(chatId, kind)
					: undefined;
			return reply ?? original(input, ...rest);
		};
	const withGet = overrideMethod(
		client,
		"session",
		"get",
		served("get", (chatId) => ({ sessionID: chatId })),
	);
	return overrideMethod(
		withGet,
		"message",
		"list",
		served("list", (chatId) => ({ sessionID: chatId, limit: OPEN_CODE_HISTORY_PAGE_SIZE })),
	);
}
