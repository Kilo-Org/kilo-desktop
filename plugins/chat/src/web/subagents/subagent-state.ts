import type { ThreadMessage } from "@assistant-ui/react";
import type { OpenCodeThreadState } from "@assistant-ui/react-opencode";

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

const normalizedText = (value: unknown) =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/** The delegation's description (or prompt) as the parent's `task` call phrased it. */
export function subagentTaskTitle(part: unknown): string | undefined {
	const input = asRecord(asRecord(asRecord(part)?.state)?.input);
	return normalizedText(input?.description) || normalizedText(input?.prompt) || undefined;
}

export type SessionTreeEntry = {
	state: OpenCodeThreadState;
	parent: OpenCodeThreadState | undefined;
};

/** Depth-first walk over a session and every (nested) subagent session below it. */
export function* walkSessionTree(root: OpenCodeThreadState): Generator<SessionTreeEntry> {
	const seen = new Set<string>();
	const stack: SessionTreeEntry[] = [{ state: root, parent: undefined }];
	while (stack.length > 0) {
		const entry = stack.pop()!;
		if (seen.has(entry.state.sessionId)) continue;
		seen.add(entry.state.sessionId);
		yield entry;
		const children = Object.values(entry.state.childSessionsById ?? {});
		for (let index = children.length - 1; index >= 0; index--) {
			stack.push({ state: children[index]!, parent: entry.state });
		}
	}
}

const hasOwnPendingInteractions = (state: OpenCodeThreadState) =>
	Object.keys(state.interactions.permissions.pending).length > 0 ||
	Object.keys(state.interactions.questions.pending).length > 0;

/** True when the session or any subagent below it is waiting on a permission or question. */
export function sessionTreeHasPendingInteractions(root: OpenCodeThreadState): boolean {
	for (const { state } of walkSessionTree(root)) {
		if (hasOwnPendingInteractions(state)) return true;
	}
	return false;
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
	// A session parked on a prompt still reports `busy`, so the prompt check goes first.
	if (child && sessionTreeHasPendingInteractions(child)) return "waiting";
	if (child?.sessionStatus?.type === "busy" || child?.sessionStatus?.type === "retry") {
		return "working";
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

export const isActiveSubagentStatus = (status: SubagentDisplayStatus): boolean =>
	status === "working" || status === "waiting";

/**
 * A delegation row's status. The child session's live state wins while it
 * runs (a background `task` call completes immediately, long before its
 * child); afterwards the call's own outcome distinguishes stopped and failed
 * runs from an aborted child that merely went idle.
 */
export function delegationStatus(
	childStatus: SubagentDisplayStatus | undefined,
	toolStatus: { type: string; reason?: string } | undefined,
): SubagentDisplayStatus {
	if (childStatus && isActiveSubagentStatus(childStatus)) return childStatus;
	if (toolStatus?.type === "incomplete") {
		return toolStatus.reason === "cancelled" ? "cancelled" : "failed";
	}
	if (childStatus) return childStatus;
	return toolStatus?.type === "running" || toolStatus?.type === "requires-action"
		? "working"
		: "done";
}

/** "code-reviewer" → "Code Reviewer". */
export const subagentTypeLabel = (agent: string | undefined): string =>
	agent
		? agent.replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
		: "Subagent";
