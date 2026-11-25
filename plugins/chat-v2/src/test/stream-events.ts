import type { OpenCodeEvent, OpenCodeServerEvent } from "@kilo-desktop/react-opencode-v2";

let nextEventId = 0;

/** A Kilo v2 event, as `@kilocode/client` delivers it: `{ id, created, type, data }`. */
export function kiloEvent(type: string, data: Record<string, unknown>): OpenCodeEvent {
	nextEventId += 1;
	return { id: `evt_${nextEventId}`, created: nextEventId, type, data } as unknown as OpenCodeEvent;
}

/** A Kilo v2 event as the window's stream delivers it, about `sessionId`. */
export function streamEvent(
	type: string,
	data: Record<string, unknown>,
	sessionId: string | undefined = typeof data.sessionID === "string" ? data.sessionID : undefined,
): OpenCodeServerEvent {
	return { type: "kilo.event", event: kiloEvent(type, data), sessionId, directory: undefined };
}

/** The type of what the stream delivered: the Kilo v2 event's, or `stream.reconnected`. */
export const streamEventType = (item: OpenCodeServerEvent): string =>
	item.type === "kilo.event" ? item.event.type : item.type;
