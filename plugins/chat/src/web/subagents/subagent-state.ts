import type { ThreadMessage } from "@assistant-ui/react";
import {
	getOpenCodeTaskSessionId,
	toolInput,
	type OpenCodeThreadState,
	type SessionMessageAssistantTool,
	type SessionMessageInfo,
} from "@kilo-desktop/react-opencode";

const normalizedText = (value: unknown) =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/** The delegation's description (or prompt) as the parent's `subagent` call phrased it. */
export function subagentTaskTitle(tool: SessionMessageAssistantTool): string | undefined {
	const input = toolInput(tool);
	return normalizedText(input.description) || normalizedText(input.prompt) || undefined;
}

/** The agent a `subagent` call delegated to (`input.agent`). */
export function subagentAgent(tool: SessionMessageAssistantTool): string {
	return normalizedText(toolInput(tool).agent);
}

export type SubagentCall = {
	readonly tool: SessionMessageAssistantTool;
	readonly childSessionId: string;
};

/** The `subagent` calls among `messages` that started a child session, in transcript order. */
export function* subagentCalls(messages: readonly SessionMessageInfo[]): Generator<SubagentCall> {
	for (const message of messages) {
		if (message.type !== "assistant") continue;
		for (const item of message.content) {
			if (item.type !== "tool") continue;
			const childSessionId = getOpenCodeTaskSessionId(item);
			if (childSessionId) yield { tool: item, childSessionId };
		}
	}
}

/** The `subagent` call among `messages` that runs `childSessionId`. */
export function subagentCallForChild(
	messages: readonly SessionMessageInfo[],
	childSessionId: string,
): SessionMessageAssistantTool | undefined {
	for (const call of subagentCalls(messages)) {
		if (call.childSessionId === childSessionId) return call.tool;
	}
	return undefined;
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
	// A session parked on a prompt still runs, so the prompt check goes first.
	if (child && sessionTreeHasPendingInteractions(child)) return "waiting";
	if (child?.running) return "working";
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
 * runs (a background `subagent` call completes immediately, long before its
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
