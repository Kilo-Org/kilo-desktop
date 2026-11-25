import type { OpenCodeEvent, SessionInfo } from "@kilocode/client";

/**
 * Kilo v2 events and sessions for tests, filled in with only what the
 * conversations area reads.
 */

let nextId = 0;

/** One event from Kilo v2's stream; `directory` is the location it came from. */
export function kiloEvent(
	type: string,
	data: Record<string, unknown> = {},
	directory?: string,
): OpenCodeEvent {
	return {
		id: `evt_${++nextId}`,
		created: 0,
		type,
		data,
		...(directory ? { location: { directory } } : {}),
	} as unknown as OpenCodeEvent;
}

/** A Kilo v2 session in `/repo`, overridden by `fields`. */
export function sessionInfo(id: string, fields: Partial<SessionInfo> = {}): SessionInfo {
	return {
		id,
		projectID: "prj",
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		time: { created: 10, updated: 20 },
		location: { directory: "/repo" },
		...fields,
	} as SessionInfo;
}
