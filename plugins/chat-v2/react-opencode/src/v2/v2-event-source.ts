import type { OpenCode, OpenCodeEvent } from "@kilocode/client";

import type { OpenCodeEventSubscriber } from "../OpenCodeEventSource";
import { V2EventTranslator, type ReadSession } from "./v2-events";

type V2Client = ReturnType<typeof OpenCode.make>;

/**
 * An `OpenCodeEventSubscriber` over Kilo v2's event stream, its events
 * translated to v1's (`v2-events.ts`), for `OpenCodeEventSource`, which keeps
 * reconnecting and announcing reconnects as before. Each connection starts a
 * fresh translator: what was in flight is reloaded with the history.
 */
export function createV2EventSubscriber(
	subscribe: (signal: AbortSignal) => AsyncIterable<OpenCodeEvent>,
	readSession?: ReadSession,
): OpenCodeEventSubscriber {
	return async ({ signal }) => {
		const translator = new V2EventTranslator(readSession ? { readSession } : {});
		const events = subscribe(signal);
		async function* stream() {
			for await (const event of events) {
				for (const translated of await translator.translate(event)) yield translated;
			}
		}
		return { stream: stream() };
	};
}

/** `createV2EventSubscriber` for a `@kilocode/client`, reading sessions with it. */
export function v2ClientEventSubscriber(client: V2Client): OpenCodeEventSubscriber {
	return createV2EventSubscriber(
		(signal) => client.event.subscribe({ signal }),
		async (sessionID) => {
			try {
				return await client.session.get({ sessionID });
			} catch {
				return undefined;
			}
		},
	);
}
