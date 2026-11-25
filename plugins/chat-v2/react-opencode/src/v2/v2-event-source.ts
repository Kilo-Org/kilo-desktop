import type { OpenCodeEvent } from "@kilocode/client";

import type { KiloClient } from "../kilo";
import type { OpenCodeEventSubscriber } from "../OpenCodeEventSource";
import { V2EventTranslator, type ReadSession } from "./v2-events";

/**
 * An `OpenCodeEventSubscriber` over Kilo v2's event stream, its transcript
 * events translated to v1's (`v2-events.ts`; permissions and forms pass
 * through as Kilo v2 sends them), for `OpenCodeEventSource`, which keeps
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
export function v2ClientEventSubscriber(client: KiloClient): OpenCodeEventSubscriber {
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
