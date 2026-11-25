"use client";

import { useMemo } from "react";
import type { MessageTiming } from "@assistant-ui/react";
import { useStreamingTiming, type StreamingTimingAccessors } from "@assistant-ui/core/react";
import type { OpenCodeThreadState } from "./types";

const assistantById = (state: OpenCodeThreadState, messageId: string) => {
	const message = state.messages.findLast((candidate) => candidate.id === messageId);
	return message?.type === "assistant" ? message : undefined;
};

export function getMessageTextLength(state: OpenCodeThreadState, messageId: string): number {
	let len = 0;
	for (const item of assistantById(state, messageId)?.content ?? []) {
		if (item.type === "text" || item.type === "reasoning") len += item.text.length;
	}
	return len;
}

export function getMessageToolCallCount(state: OpenCodeThreadState, messageId: string): number {
	return (assistantById(state, messageId)?.content ?? []).filter((item) => item.type === "tool")
		.length;
}

export function getLastAssistantId(state: OpenCodeThreadState): string | undefined {
	return state.messages.findLast((message) => message.type === "assistant")?.id;
}

// OpenCode tracks timing off a single thread-state snapshot rather than a
// message list, so the snapshot is wrapped in a one-element array to satisfy
// the shared primitive's `readonly TMessage[]` contract. The wrapper is
// memoized on `state` so the primitive's effect keeps the original
// `[state, isRunning]` reactivity (runs on state change, not every render).
const stateOf = (messages: readonly OpenCodeThreadState[]) => messages[0];

const openCodeStreamingTimingAccessors: StreamingTimingAccessors<OpenCodeThreadState> = {
	getAssistantMessageId: (messages) => {
		const state = stateOf(messages);
		return state ? getLastAssistantId(state) : undefined;
	},
	getTextLength: (messages, messageId) => {
		const state = stateOf(messages);
		return state ? getMessageTextLength(state, messageId) : 0;
	},
	getToolCallCount: (messages, messageId) => {
		const state = stateOf(messages);
		return state ? getMessageToolCallCount(state, messageId) : 0;
	},
};

/**
 * Tracks per-message streaming timing for OpenCode messages. Delegates to
 * the shared `useStreamingTiming` primitive in `@assistant-ui/core/react`,
 * adapted to the `OpenCodeThreadState` snapshot shape (`messagesById` +
 * `messageOrder`). Timing is finalized when streaming ends and stored per
 * message id.
 */
export const useOpenCodeStreamingTiming = (
	state: OpenCodeThreadState,
	isRunning: boolean,
): Record<string, MessageTiming> => {
	const messages = useMemo(() => [state], [state]);
	return useStreamingTiming(messages, isRunning, openCodeStreamingTimingAccessors);
};
