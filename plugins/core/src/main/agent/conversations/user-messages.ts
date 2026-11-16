import type { KiloEvent } from "./activity";

export interface UserMessage {
	readonly chatId: string;
	readonly messageId: string;
	readonly text: string;
	readonly model?: { readonly providerID: string; readonly modelID: string };
}

/** Bounds the ids remembered per kind; old ones are forgotten first. */
const MAX_REMEMBERED = 500;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

function remember<T>(map: Map<string, T>, key: string, value: T): void {
	map.set(key, value);
	if (map.size > MAX_REMEMBERED) map.delete(map.keys().next().value!);
}

function readModel(value: unknown): UserMessage["model"] {
	const model = asRecord(value);
	const providerID = asString(model?.providerID);
	const modelID = asString(model?.modelID);
	return providerID && modelID ? { providerID, modelID } : undefined;
}

/**
 * Picks the messages people send out of the server's stream: a user message
 * (`message.updated`, role `user`) is announced once, with its first text
 * part the person wrote (the server writes the message before its parts).
 * Messages without such a part are never announced.
 */
export class UserMessageTracker {
	readonly #awaitingText = new Map<string, Omit<UserMessage, "text">>();
	readonly #announced = new Map<string, true>();

	observe(event: KiloEvent): UserMessage | undefined {
		if (event.type === "message.updated") {
			const info = asRecord(event.properties.info);
			const messageId = asString(info?.id);
			const chatId = asString(info?.sessionID);
			if (info?.role !== "user" || !messageId || !chatId) return undefined;
			if (this.#announced.has(messageId) || this.#awaitingText.has(messageId)) return undefined;
			const model = readModel(info.model);
			remember(this.#awaitingText, messageId, { chatId, messageId, ...(model ? { model } : {}) });
			return undefined;
		}
		if (event.type !== "message.part.updated") return undefined;
		const part = asRecord(event.properties.part);
		const messageId = asString(part?.messageID);
		if (!part || !messageId || part.type !== "text" || part.synthetic || part.ignored) {
			return undefined;
		}
		const pending = this.#awaitingText.get(messageId);
		const text = typeof part.text === "string" ? part.text : "";
		if (!pending || !text.trim()) return undefined;
		this.#awaitingText.delete(messageId);
		remember(this.#announced, messageId, true);
		return { ...pending, text };
	}
}
