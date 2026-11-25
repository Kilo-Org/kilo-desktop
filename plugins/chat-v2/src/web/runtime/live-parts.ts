import type {
	OpenCodeEvent,
	OpenCodeServerEvent,
	SessionMessageInfo,
} from "@kilo-desktop/react-opencode-v2";

/*
 * The text of every step item (text or reasoning) the window's stream is
 * streaming, so a history read made mid-stream shows it.
 *
 * - Kilo v2 streams a step's text and reasoning as `session.text.*` /
 *   `session.reasoning.*` events (`started`, `delta`, `ended`), naming the item
 *   by its step (`assistantMessageID`) and `ordinal`. A history read mid-step
 *   holds the item as far as the server had it; a thread that reads its
 *   history then (a pane opened again, a hidden work session shown again and
 *   refreshed, a resync after the stream reconnects) would show just the
 *   deltas after the read until the step's next read.
 * - Kept per item from its `started` event (so its text is whole). An `ended`
 *   event keeps the final text for `ENDED_PART_TTL_MS`: a read the server
 *   answered before the end but the thread reads after it would otherwise put
 *   the unfinished text back.
 * - Dropped when its chat's turn ends (an item still streaming then was cut
 *   off) or the chat is deleted, and when a read shows its step finished: a
 *   finished step is the server's final word.
 * - Kept across a reconnect, which makes every thread reload: what the stream
 *   gave before the drop is still the start of the text.
 * - Fed by the same batched listener as the threads, so at any moment it holds
 *   exactly what a subscribed thread has been given: a history read patched
 *   from it and the deltas delivered after it add up without overlap.
 * - A read's item is only replaced while the live text extends it.
 */

/** How long an ended item still patches reads answered before it ended. */
export const ENDED_PART_TTL_MS = 10_000;

type Kind = "text" | "reasoning";

interface LiveItem {
	readonly sessionId: string;
	readonly messageId: string;
	text: string;
	/** When the ended item stops patching reads, once it has ended. */
	expires?: number;
}

type StreamEvent = Extract<
	OpenCodeEvent,
	{
		type:
			| "session.text.started"
			| "session.text.delta"
			| "session.text.ended"
			| "session.reasoning.started"
			| "session.reasoning.delta"
			| "session.reasoning.ended";
	}
>;

const STREAM_EVENT = /^session\.(text|reasoning)\.(started|delta|ended)$/;
const TURN_ENDED = /^session\.execution\.(succeeded|failed|interrupted)$/;

const keyOf = (sessionId: string, messageId: string, kind: Kind, ordinal: number) =>
	`${sessionId}:${messageId}:${kind}:${ordinal}`;

export class LiveParts {
	readonly #items = new Map<string, LiveItem>();

	apply(item: OpenCodeServerEvent): void {
		this.#dropExpired();
		if (item.type !== "kilo.event" || !item.sessionId) return;
		const { event, sessionId } = item;
		const match = STREAM_EVENT.exec(event.type);
		if (match) {
			this.#stream(sessionId, match[1] as Kind, match[2]!, event as StreamEvent);
			return;
		}
		if (TURN_ENDED.test(event.type)) this.#drop(sessionId, (live) => live.expires === undefined);
		else if (event.type === "session.deleted") this.#drop(sessionId, () => true);
	}

	/** `messages` with each unfinished step's items as far as they have streamed. */
	patchMessages(
		chatId: string,
		messages: readonly SessionMessageInfo[],
	): readonly SessionMessageInfo[] {
		this.#dropExpired();
		if (![...this.#items.values()].some((item) => item.sessionId === chatId)) return messages;
		return messages.map((message) => this.#patchMessage(chatId, message));
	}

	clear(): void {
		this.#items.clear();
	}

	#stream(sessionId: string, kind: Kind, phase: string, event: StreamEvent): void {
		const { assistantMessageID: messageId, ordinal } = event.data;
		const key = keyOf(sessionId, messageId, kind, ordinal);
		if (phase === "started") {
			this.#items.set(key, { sessionId, messageId, text: "" });
			return;
		}
		const live = this.#items.get(key);
		if (phase === "delta") {
			if (live && live.expires === undefined && "delta" in event.data) {
				live.text += event.data.delta;
			}
			return;
		}
		if (!("text" in event.data)) return;
		this.#items.set(key, {
			sessionId,
			messageId,
			text: event.data.text,
			expires: Date.now() + ENDED_PART_TTL_MS,
		});
	}

	#patchMessage(chatId: string, message: SessionMessageInfo): SessionMessageInfo {
		if (message.type !== "assistant") return message;
		if (message.time.completed !== undefined) {
			this.#drop(chatId, (item) => item.messageId === message.id && item.expires === undefined);
			return message;
		}
		const ordinals = { text: 0, reasoning: 0 };
		let changed = false;
		const content = message.content.map((item) => {
			if (item.type === "tool") return item;
			const live = this.#items.get(keyOf(chatId, message.id, item.type, ordinals[item.type]++));
			if (!live || live.text.length <= item.text.length || !live.text.startsWith(item.text)) {
				return item;
			}
			changed = true;
			return { ...item, text: live.text };
		});
		return changed ? { ...message, content } : message;
	}

	#drop(sessionId: string, matches: (item: LiveItem) => boolean): void {
		for (const [key, item] of this.#items) {
			if (item.sessionId === sessionId && matches(item)) this.#items.delete(key);
		}
	}

	#dropExpired(): void {
		const now = Date.now();
		for (const [key, item] of this.#items) {
			if (item.expires !== undefined && item.expires <= now) this.#items.delete(key);
		}
	}
}
