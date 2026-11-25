import { useAuiState } from "@assistant-ui/react";
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@kilo-desktop/react-opencode";

/**
 * Readers for the Kilo v2 messages behind a projected transcript message
 * (`metadata.custom.opencode.messages`), for what the tool-call parts leave
 * out: tool metadata (diffs, live shell output, subagent session) and file
 * content.
 */

const EMPTY_MESSAGES: readonly SessionMessageInfo[] = [];

/** The v2 messages behind a projected message: its user message, or a turn's steps and idle. */
export const openCodeMessagesOf = (metadata: unknown): readonly SessionMessageInfo[] => {
	const custom = (metadata as { custom?: { opencode?: { messages?: unknown } } } | undefined)
		?.custom;
	const messages = custom?.opencode?.messages;
	return Array.isArray(messages) ? (messages as readonly SessionMessageInfo[]) : EMPTY_MESSAGES;
};

/** The enclosing message's v2 messages. */
export const useOpenCodeMessages = (): readonly SessionMessageInfo[] =>
	useAuiState((state) => openCodeMessagesOf(state.message.metadata));

/** The v2 tool call with this id (`toolCallId` = tool `id`) among a turn's steps. */
export const findOpenCodeTool = (
	messages: readonly SessionMessageInfo[],
	toolCallId: string,
): SessionMessageAssistantTool | undefined => {
	for (const message of messages) {
		if (message.type !== "assistant") continue;
		for (const item of message.content) {
			if (item.type === "tool" && item.id === toolCallId) return item;
		}
	}
	return undefined;
};

/** The tool's metadata: live progress while running, its final metadata once settled. */
export const openCodeToolMetadata = (
	tool: SessionMessageAssistantTool | undefined,
): Record<string, unknown> | undefined => {
	const metadata = (tool?.state as { metadata?: unknown } | undefined)?.metadata;
	return metadata && typeof metadata === "object" && !Array.isArray(metadata)
		? (metadata as Record<string, unknown>)
		: undefined;
};

/** The enclosing message's v2 tool call with this id. */
export const useOpenCodeTool = (toolCallId: string): SessionMessageAssistantTool | undefined =>
	useAuiState((state) => findOpenCodeTool(openCodeMessagesOf(state.message.metadata), toolCallId));

/** The step ids behind a projected assistant message (one per model step). */
export const openCodeStepIds = (messages: readonly SessionMessageInfo[]): Set<string> => {
	const ids = new Set<string>();
	for (const message of messages) if (message.type === "assistant") ids.add(message.id);
	return ids;
};
