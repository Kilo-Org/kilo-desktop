import type { SessionMessageInfo } from "@kilo-desktop/react-opencode-v2";

type StatusPart = {
	type: string;
	status?: { type: string } | undefined;
};

/**
 * True when a tool call or reasoning part is still running, so the activity
 * subgroup already shows live status (Delegating, Thinking, Running bash).
 */
export function messageHasInFlightActivity(parts: readonly StatusPart[]): boolean {
	return parts.some(
		(part) =>
			(part.type === "tool-call" || part.type === "reasoning") && part.status?.type === "running",
	);
}

/**
 * The assistant-ui projection marks the last text part "running" for as long
 * as the message runs, so it cannot tell streaming text from a finished
 * paragraph. Kilo's messages behind it (`metadata.custom.opencode.messages`)
 * can: a step still running whose latest content is text is streaming it.
 */
export function openCodeTextIsStreaming(messages: readonly SessionMessageInfo[]): boolean {
	return messages.some(
		(message) =>
			message.type === "assistant" &&
			message.time.completed === undefined &&
			message.content.at(-1)?.type === "text",
	);
}

/**
 * GroupedParts shows "Considering next steps" only when the running turn is
 * idle between steps. Hide it while the run is blocked on the user
 * (question such as the plan follow-up, or permission), while reply text is
 * visibly streaming, while subagents own the work, or when a tool / subgroup
 * already owns the live status row.
 */
export function assistantWorkingIndicatorMode({
	pendingUserInteractions,
	hasInFlightActivity,
	isStreamingText,
	hasActiveSubagents,
}: {
	pendingUserInteractions: number;
	hasInFlightActivity: boolean;
	isStreamingText: boolean;
	hasActiveSubagents: boolean;
}): "never" | "no-text" {
	if (pendingUserInteractions > 0 || hasInFlightActivity || isStreamingText || hasActiveSubagents) {
		return "never";
	}
	return "no-text";
}
