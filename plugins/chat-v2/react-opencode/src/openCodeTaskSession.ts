import type { KiloAssistantContent } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** The child session a Kilo v2 `subagent` call runs in (its metadata's `sessionID`). */
export const getOpenCodeTaskSessionId = (item: KiloAssistantContent | unknown) => {
	if (!isRecord(item) || item.type !== "tool" || item.name !== "subagent") return undefined;
	const state = isRecord(item.state) ? item.state : undefined;
	const metadata = isRecord(state?.metadata) ? state.metadata : undefined;
	const value = metadata?.sessionID;
	return typeof value === "string" && value.length > 0 ? value : undefined;
};
