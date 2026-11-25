import type {
	OpenCodeServerEvent,
	SessionMessageAssistant,
	SessionMessageInfo,
} from "@kilo-desktop/react-opencode";
import type { OpenCodeClient } from "@kilocode/client";

import { overrideMethod } from "./override-method";

/*
 * The text of every text and reasoning part the window's stream is streaming,
 * so a history read made mid-stream shows it.
 *
 * - kilo2 stores a part's text only when it ends (`session.text.ended`); in
 *   between it exists only as ephemeral deltas. A thread that reads its
 *   history mid-stream (a pane opened again, a resync after a reconnect)
 *   would show the part empty, then only the deltas after the read.
 * - A part is known by its session, assistant message, kind and ordinal (its
 *   place among the message's parts of that kind), from its `started` event,
 *   so its text is whole.
 * - An ended part is kept for `ENDED_PART_TTL_MS` with its final text: a read
 *   the server answered before the end but the thread reads after it would
 *   otherwise show it empty, its end already applied to the old state.
 * - A part still streaming is forgotten when its step ends or fails (it was
 *   cut off), when its session's execution ends, and every part of a deleted
 *   session.
 * - Fed by the same batched listener as the threads, so it holds exactly
 *   what a subscribed thread has been given: a read patched from it and the
 *   deltas delivered after it add up without overlap.
 * - A read's part is replaced only when the live text extends it.
 */

/** How long an ended part still patches reads answered before it ended. */
export const ENDED_PART_TTL_MS = 10_000;

type Kind = "text" | "reasoning";

interface LivePart {
	readonly sessionId: string;
	readonly messageId: string;
	text: string;
	/** When an ended part stops patching reads. */
	expires?: number;
}

const STREAMED = /^session\.(text|reasoning)\.(started|delta|ended)$/;
const EXECUTION_END = new Set([
	"session.execution.succeeded",
	"session.execution.failed",
	"session.execution.interrupted",
	"session.idle",
]);

const keyOf = (sessionId: string, messageId: string, kind: Kind, ordinal: number) =>
	`${sessionId}\n${messageId}\n${kind}\n${ordinal}`;

export class LiveParts {
	readonly #parts = new Map<string, LivePart>();

	/** Applies one event from the window's (batched) stream. */
	apply(event: OpenCodeServerEvent): void {
		this.#dropExpired();
		const { sessionId, data } = event;
		if (!sessionId) return;
		const messageId = data.assistantMessageID;
		const streamed = STREAMED.exec(event.type);
		if (streamed) {
			if (typeof messageId !== "string" || typeof data.ordinal !== "number") return;
			const key = keyOf(sessionId, messageId, streamed[1] as Kind, data.ordinal);
			this.#stream(key, streamed[2]!, { sessionId, messageId, data });
			return;
		}
		if (event.type === "session.step.ended" || event.type === "session.step.failed") {
			this.#forget((part) => !part.expires && part.messageId === messageId);
		} else if (EXECUTION_END.has(event.type)) {
			this.#forget((part) => !part.expires && part.sessionId === sessionId);
		} else if (event.type === "session.deleted") {
			this.#forget((part) => part.sessionId === sessionId);
		}
	}

	/** `messages` (a `message.list` page of `chatId`) with live text filled in. */
	patchMessages(chatId: string, messages: readonly SessionMessageInfo[]): SessionMessageInfo[] {
		this.#dropExpired();
		return messages.map((message) =>
			message.type === "assistant" ? this.#patchAssistant(chatId, message) : message,
		);
	}

	clear(): void {
		this.#parts.clear();
	}

	#stream(
		key: string,
		phase: string,
		{
			sessionId,
			messageId,
			data,
		}: { sessionId: string; messageId: string; data: Record<string, unknown> },
	): void {
		if (phase === "started") {
			this.#parts.set(key, { sessionId, messageId, text: "" });
			return;
		}
		const live = this.#parts.get(key);
		if (phase === "delta") {
			if (live && !live.expires && typeof data.delta === "string") live.text += data.delta;
			return;
		}
		const text = typeof data.text === "string" ? data.text : (live?.text ?? "");
		this.#parts.set(key, { sessionId, messageId, text, expires: Date.now() + ENDED_PART_TTL_MS });
	}

	#patchAssistant(chatId: string, message: SessionMessageAssistant): SessionMessageInfo {
		const ordinals = { text: 0, reasoning: 0 };
		let changed = false;
		const content = message.content.map((item) => {
			if (item.type !== "text" && item.type !== "reasoning") return item;
			const live = this.#parts.get(keyOf(chatId, message.id, item.type, ordinals[item.type]++));
			if (!live || live.text.length <= item.text.length || !live.text.startsWith(item.text)) {
				return item;
			}
			changed = true;
			return { ...item, text: live.text };
		});
		return changed ? { ...message, content } : message;
	}

	#forget(matches: (part: LivePart) => boolean): void {
		for (const [key, part] of this.#parts) {
			if (matches(part)) this.#parts.delete(key);
		}
	}

	#dropExpired(): void {
		const now = Date.now();
		this.#forget((part) => part.expires !== undefined && part.expires <= now);
	}
}

/*
 * The reply's data is patched when the thread reads it, not when it arrives: a
 * thread awaits its other history reads too, and deltas delivered meanwhile are
 * in `LiveParts` (and applied to the thread's old state) by then.
 */
function withLazyData<T extends { data: readonly SessionMessageInfo[] }>(
	reply: T,
	patch: (data: readonly SessionMessageInfo[]) => SessionMessageInfo[],
): T {
	const { data, ...rest } = reply;
	let patched: SessionMessageInfo[] | undefined;
	return Object.defineProperty(rest, "data", {
		enumerable: true,
		configurable: true,
		get: () => (patched ??= patch(data)),
	}) as T;
}

/** `client`, whose `message.list` replies carry `live`'s streamed text. */
export function withLiveParts(client: OpenCodeClient, live: LiveParts): OpenCodeClient {
	return overrideMethod(
		client,
		"message",
		"list",
		(list) =>
			async (input: unknown, ...rest: unknown[]) => {
				const reply = (await list(input, ...rest)) as Awaited<
					ReturnType<OpenCodeClient["message"]["list"]>
				>;
				const sessionId = (input as { sessionID?: unknown } | undefined)?.sessionID;
				if (typeof sessionId !== "string" || !Array.isArray(reply?.data)) return reply;
				return withLazyData(reply, (data) => live.patchMessages(sessionId, data));
			},
	);
}
