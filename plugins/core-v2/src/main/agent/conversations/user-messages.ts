import type { OpenCodeEvent } from "@kilocode/client";

import type { ModelRef } from "../../../contracts";

export interface UserMessage {
	readonly chatId: string;
	readonly messageId: string;
	readonly text: string;
	readonly model?: ModelRef;
}

/** Bounds the ids remembered; old ones are forgotten first. */
const MAX_REMEMBERED = 500;

/**
 * Picks the messages people send out of the server's stream: a `user` item
 * entering a session's inbox (`session.inbox.enqueued`), announced once, with
 * the model it was sent with when it names one. Synthetic notes, compactions
 * and moves are never announced, nor a message without text.
 */
export class UserMessageTracker {
	readonly #announced = new Set<string>();

	observe(event: OpenCodeEvent): UserMessage | undefined {
		if (event.type !== "session.inbox.enqueued" || event.data.item.type !== "user")
			return undefined;
		const { sessionID, inboxID, item } = event.data;
		const text = item.payload.text;
		if (!text.trim() || this.#announced.has(inboxID)) return undefined;
		this.#announced.add(inboxID);
		if (this.#announced.size > MAX_REMEMBERED) {
			this.#announced.delete(this.#announced.values().next().value!);
		}
		const model = item.payload.selection?.model;
		return {
			chatId: sessionID,
			messageId: inboxID,
			text,
			...(model ? { model: { aiProviderId: model.providerID, modelId: model.id } } : {}),
		};
	}
}
