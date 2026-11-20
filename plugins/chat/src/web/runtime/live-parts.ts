import type { OpenCodeServerEvent } from "@assistant-ui/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

/*
 * The text of every part the window's stream is streaming, so a history read
 * made mid-stream shows it.
 *
 * - The server stores a text or reasoning part empty when it starts and only
 *   stores its text when it ends; in between the text exists only as
 *   `message.part.delta` events. A thread that reads its history mid-stream (a
 *   pane opened again, a hidden work session shown again and refreshed, a
 *   resync after the stream reconnects) would show just the deltas after the
 *   read until the part's end replaced it whole.
 * - Kept per part from its first `message.part.updated` (so its text is
 *   whole). An ending update keeps the ended part for `ENDED_PART_TTL_MS`: a
 *   read the server answered before the end but the thread reads after it
 *   would otherwise put the unfinished text back over the ended part.
 * - Dropped when the part or its message is removed, or when its chat goes
 *   idle (a part still streaming then was cut off).
 * - Kept across a reconnect, which makes every thread reload: what the stream
 *   gave before the drop is still the start of the text, and a reload whose
 *   part has ended carries the whole text, which wins.
 * - Fed by the same batched listener as the threads, so at any moment it holds
 *   exactly what a subscribed thread has been given: a history read patched
 *   from it and the deltas delivered after it add up without overlap.
 * - A read's part is only replaced while it is unfinished and the live text
 *   extends it; a stored part that has ended is the server's final word.
 */

/** How long an ended part still patches reads answered before it ended. */
export const ENDED_PART_TTL_MS = 10_000;

interface LivePart {
	readonly sessionId: string;
	readonly messageId: string;
	text: string;
	/** The whole ending update, once the part has ended. */
	ended?: { readonly part: UnknownRecord; readonly expires: number };
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
	typeof value === "object" && value !== null ? (value as UnknownRecord) : null;

const isStreamedText = (part: UnknownRecord) =>
	part["type"] === "text" || part["type"] === "reasoning";

const hasEnded = (part: UnknownRecord) => asRecord(part["time"])?.["end"] != null;

const textOf = (part: UnknownRecord) => (typeof part["text"] === "string" ? part["text"] : "");

export class LiveParts {
	readonly #parts = new Map<string, LivePart>();
	/** Applies one event from the window's (batched) stream. */
	apply(event: OpenCodeServerEvent): void {
		this.#dropExpired();
		const properties = event.properties;
		switch (event.type) {
			case "message.part.updated": {
				const part = asRecord(properties["part"]);
				const id = part?.["id"];
				if (!part || typeof id !== "string") return;
				const sessionId = part["sessionID"];
				const messageId = part["messageID"];
				if (
					!isStreamedText(part) ||
					typeof sessionId !== "string" ||
					typeof messageId !== "string"
				) {
					this.#parts.delete(id);
					return;
				}
				const text = textOf(part);
				const ended = hasEnded(part)
					? { part, expires: Date.now() + ENDED_PART_TTL_MS }
					: undefined;
				this.#parts.set(id, { sessionId, messageId, text, ...(ended ? { ended } : {}) });
				return;
			}
			case "message.part.delta": {
				const { partID, field, delta } = properties;
				if (field !== "text" || typeof partID !== "string" || typeof delta !== "string") return;
				const live = this.#parts.get(partID);
				if (live && !live.ended) live.text += delta;
				return;
			}
			case "message.part.removed": {
				const { partID } = properties;
				if (typeof partID === "string") this.#parts.delete(partID);
				return;
			}
			case "message.removed": {
				const { messageID } = properties;
				for (const [id, live] of this.#parts) {
					if (live.messageId === messageID) this.#parts.delete(id);
				}
				return;
			}
			case "session.idle":
				if (event.sessionId) this.#dropStreaming(event.sessionId);
				return;
			case "session.deleted":
				if (event.sessionId) this.#dropSession(event.sessionId);
				return;
		}
	}

	/** `messages` (a `session.messages` reply's data) with live text filled in. */
	patchMessages(chatId: string, messages: unknown): unknown {
		this.#dropExpired();
		if (!Array.isArray(messages) || !this.#hasSession(chatId)) return messages;
		return messages.map((message: unknown) => {
			const record = asRecord(message);
			const parts = record?.["parts"];
			if (!record || !Array.isArray(parts)) return message;
			let changed = false;
			const nextParts = parts.map((part: unknown) => {
				const patched = this.#patchPart(chatId, part);
				if (patched !== part) changed = true;
				return patched;
			});
			return changed ? { ...record, parts: nextParts } : message;
		});
	}

	clear(): void {
		this.#parts.clear();
	}

	#patchPart(chatId: string, part: unknown): unknown {
		const record = asRecord(part);
		const id = record?.["id"];
		if (!record || typeof id !== "string") return part;
		const live = this.#parts.get(id);
		if (!live || live.sessionId !== chatId || !isStreamedText(record) || hasEnded(record)) {
			return part;
		}
		const stored = textOf(record);
		if (!live.text.startsWith(stored)) return part;
		if (live.ended) return live.ended.part;
		if (live.text.length <= stored.length) return part;
		return { ...record, text: live.text };
	}

	#hasSession(chatId: string): boolean {
		for (const live of this.#parts.values()) {
			if (live.sessionId === chatId) return true;
		}
		return false;
	}

	#dropStreaming(chatId: string): void {
		for (const [id, live] of this.#parts) {
			if (live.sessionId === chatId && !live.ended) this.#parts.delete(id);
		}
	}

	#dropSession(chatId: string): void {
		for (const [id, live] of this.#parts) {
			if (live.sessionId === chatId) this.#parts.delete(id);
		}
	}

	#dropExpired(): void {
		const now = Date.now();
		for (const [id, live] of this.#parts) {
			if (live.ended && live.ended.expires <= now) this.#parts.delete(id);
		}
	}
}

/*
 * The reply's data is patched when the thread reads it, not when it arrives: a
 * thread awaits its other history read too, and deltas delivered meanwhile are
 * in `LiveParts` (and applied to the thread's old state) by then.
 */
function withLazyData(reply: UnknownRecord, patch: (data: unknown) => unknown): UnknownRecord {
	const { data, ...rest } = reply;
	let patched: { value: unknown } | undefined;
	return Object.defineProperty(rest, "data", {
		enumerable: true,
		configurable: true,
		get: () => (patched ??= { value: patch(data) }).value,
	});
}

/** `client`, whose `session.messages` replies for `chatId` carry `live`'s streamed text. */
export function withLiveParts(client: KiloClient, chatId: string, live: LiveParts): KiloClient {
	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop !== "session" || value === null || typeof value !== "object") return value;
			return new Proxy(value as object, {
				get(sessionTarget, sessionProp, sessionReceiver) {
					const method = Reflect.get(sessionTarget, sessionProp, sessionReceiver);
					if (sessionProp !== "messages" || typeof method !== "function") return method;
					return async (...args: unknown[]) => {
						const reply = await Reflect.apply(method, sessionTarget, args);
						const record = asRecord(reply);
						if (!record || !("data" in record)) return reply;
						return withLazyData(record, (data) => live.patchMessages(chatId, data));
					};
				},
			});
		},
	}) as KiloClient;
}
