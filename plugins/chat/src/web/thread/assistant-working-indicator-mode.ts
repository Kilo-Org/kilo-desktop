import type { SessionMessageInfo } from "@kilo-desktop/react-opencode";

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
 * paragraph. The v2 steps behind it (message.metadata.custom.opencode.messages)
 * can: the latest step is still emitting text while it has neither streamed
 * nor completed and text is its newest content.
 */
export function openCodeTextIsStreaming(messages: readonly SessionMessageInfo[]): boolean {
	const step = messages.findLast((message) => message.type === "assistant");
	if (step?.type !== "assistant" || step.time.streamed || step.time.completed) return false;
	return step.content.at(-1)?.type === "text";
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
