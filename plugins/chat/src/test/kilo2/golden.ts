import type { SessionInfo, SessionMessageInfo, V2Event } from "@kilocode/client";

import goldenTurn from "./golden-turn.json";

/**
 * One real kilo2 turn, recorded by `golden-turn.test.ts` and normalized:
 * the session, its events in stream order (frame ids and locations dropped)
 * and its messages as `message.list` serves them.
 */
export interface GoldenTurn {
	readonly session: SessionInfo;
	readonly events: readonly { readonly type: V2Event["type"]; readonly data: unknown }[];
	readonly messages: readonly SessionMessageInfo[];
}

export const GOLDEN_TURN = goldenTurn as unknown as GoldenTurn;
