import type { ThreadMessage } from "@assistant-ui/react";
import type { OpenCodeThreadState } from "@assistant-ui/react-opencode";

export const SUBAGENT_CHILD_SESSION_METADATA_KEY = "childSessionId";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const sessionIdFromMetadata = (metadata: unknown): string | undefined => {
	const record = asRecord(metadata);
	const sessionId = record?.sessionId ?? record?.sessionID;
	return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
};

export function childSessionIdFromTaskPart(part: unknown): string | undefined {
	const record = asRecord(part);
	if (record?.type !== "tool" || record.tool !== "task") return undefined;
	const state = asRecord(record.state);
	return sessionIdFromMetadata(state?.metadata) ?? sessionIdFromMetadata(record.metadata);
}

export function childSessionIdForToolCall(parts: unknown, toolCallId: string): string | undefined {
	if (!Array.isArray(parts)) return undefined;
	for (const part of parts) {
		const record = asRecord(part);
		if ((record?.callID ?? record?.id) !== toolCallId) continue;
		return childSessionIdFromTaskPart(part);
	}
	return undefined;
}

export const subagentPaneInstanceId = (childSessionId: string): string =>
	`subagent:${childSessionId}`;

export type SubagentTranscript =
	| { type: "loading" }
	| { type: "unavailable" }
	| { type: "error" }
	| {
			type: "ready";
			messages: readonly ThreadMessage[];
			state: OpenCodeThreadState;
	  };

export function selectSubagentTranscript(
	parentState: OpenCodeThreadState | undefined,
	childSessionId: string,
	messages: readonly ThreadMessage[] = [],
): SubagentTranscript {
	if (!parentState) return { type: "loading" };
	const child = parentState.childSessionsById[childSessionId];
	if (!child) {
		if (parentState.loadState.type === "error") return { type: "error" };
		return parentState.loadState.type === "ready" ? { type: "unavailable" } : { type: "loading" };
	}
	if (child.loadState.type === "error") return { type: "error" };
	if (child.loadState.type !== "ready") return { type: "loading" };
	return { type: "ready", messages, state: child };
}

export type SubagentDisplayStatus = "working" | "waiting" | "done" | "failed" | "cancelled";

export function subagentDisplayStatus(
	child: OpenCodeThreadState | undefined,
	fallback?: { type: string; reason?: string },
): SubagentDisplayStatus {
	if (child?.sessionStatus?.type === "busy" || child?.sessionStatus?.type === "retry") {
		return "working";
	}
	if (
		Object.keys(child?.interactions.permissions.pending ?? {}).length > 0 ||
		Object.keys(child?.interactions.questions.pending ?? {}).length > 0
	) {
		return "waiting";
	}
	if (
		child?.runState.type === "error" ||
		(fallback?.type === "incomplete" && fallback.reason === "error")
	) {
		return "failed";
	}
	if (
		child?.runState.type === "streaming" ||
		child?.runState.type === "cancelling" ||
		child?.runState.type === "reverting"
	) {
		return "working";
	}
	if (fallback?.type === "incomplete" && fallback.reason === "cancelled") return "cancelled";
	if (fallback?.type === "running") return "working";
	return "done";
}
