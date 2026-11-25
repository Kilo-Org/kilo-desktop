import type { SessionMessageAssistantTool } from "@kilocode/client";

/** The tool that runs a subagent in a child session (kilo2's `subagent`). */
export const SUBAGENT_TOOL = "subagent";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** The child session a subagent call runs in (`state.metadata.sessionID`, set once it starts). */
export const getOpenCodeTaskSessionId = (
	tool: Pick<SessionMessageAssistantTool, "name" | "state">,
): string | undefined => {
	if (tool.name !== SUBAGENT_TOOL) return undefined;
	const metadata = (tool.state as { metadata?: unknown }).metadata;
	const value = isRecord(metadata) ? metadata.sessionID : undefined;
	return typeof value === "string" && value.length > 0 ? value : undefined;
};
