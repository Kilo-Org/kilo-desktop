import type { KiloEvent } from "./activity";

export interface UserMessage {
	readonly chatId: string;
	readonly messageId: string;
	readonly text: string;
	readonly model?: { readonly providerID: string; readonly modelID: string };
}

/** Bounds the ids and models remembered; old ones are forgotten first. */
const MAX_REMEMBERED = 500;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

function remember<T>(map: Map<string, T>, key: string, value: T): void {
	map.delete(key);
	map.set(key, value);
	if (map.size > MAX_REMEMBERED) map.delete(map.keys().next().value!);
}

/** A v2 `Model.Ref` (`{ providerID, id }`). */
function readModel(value: unknown): UserMessage["model"] {
	const model = asRecord(value);
	const providerID = asString(model?.providerID);
	const modelID = asString(model?.id);
	return providerID && modelID ? { providerID, modelID } : undefined;
}

/**
 * Picks the messages people send out of the server's stream: every prompt is
 * admitted to the chat's inbox (`session.inbox.enqueued` with a `user` item)
 * with its text, and is announced once. The model is the one the prompt
 * selected, else the one the chat last switched to (Desktop switches the
 * chat's model before prompting). Synthetic notes and copied fork history are
 * never admitted as user items, so they are never announced.
 */
export class UserMessageTracker {
	readonly #announced = new Map<string, true>();
	readonly #models = new Map<string, NonNullable<UserMessage["model"]>>();

	observe(event: KiloEvent): UserMessage | undefined {
		const chatId = asString(event.data.sessionID);
		if (!chatId) return undefined;
		if (event.type === "session.model.selected" || event.type === "session.created") {
			const model = readModel(event.data.model);
			if (model) remember(this.#models, chatId, model);
			return undefined;
		}
		if (event.type !== "session.inbox.enqueued") return undefined;
		const item = asRecord(event.data.item);
		const payload = asRecord(item?.payload);
		const messageId = asString(event.data.inboxID);
		const text = typeof payload?.text === "string" ? payload.text : "";
		if (item?.type !== "user" || !messageId || !text.trim()) return undefined;
		if (this.#announced.has(messageId)) return undefined;
		remember(this.#announced, messageId, true);
		const model = readModel(asRecord(payload?.selection)?.model) ?? this.#models.get(chatId);
		return { chatId, messageId, text, ...(model ? { model } : {}) };
	}
}
