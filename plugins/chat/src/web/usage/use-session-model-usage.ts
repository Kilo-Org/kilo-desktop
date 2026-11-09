import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuiState } from "@assistant-ui/react";

import { useCallback } from "react";

import { useDomainState } from "@kilo-desktop/kernel/web";
import { Conversations, type ChatSummary } from "@kilo-desktop/plugin-agent/contracts";

import { useComposerContext } from "../composer/composer-actions";
import { useChatConnection } from "../runtime/chat-connection";
import { useChatModelSelection } from "../selection/ChatModelSelectionContext";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import {
	fallbackTotalsFromMessages,
	fetchSessionModelUsage,
	lastAssistantCost,
	lastAssistantId,
	lastAssistantTokens,
	resolveServerSessionId,
	toComposerUsageView,
	type ComposerUsageView,
	type ThreadUsageMessage,
} from "./session-model-usage";

function asSessionRef(value: unknown): { id: string; directory?: string } | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as { id?: unknown; directory?: unknown };
	if (typeof record.id !== "string" || record.id.length === 0) return undefined;
	return {
		id: record.id,
		...(typeof record.directory === "string" && record.directory.length > 0
			? { directory: record.directory }
			: {}),
	};
}

export function useComposerUsageView(): ComposerUsageView | undefined {
	const isDraft = useAuiState(
		(state) => state.thread.messages.length === 0 && state.threadListItem.status === "new",
	);
	const threadId = useAuiState((state) => state.threadListItem.id);
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const isRunning = useAuiState((state) => state.thread.isRunning);
	const extras = useOptionalOpenCodeRuntimeExtras();
	const session = asSessionRef(extras?.session);
	const { connection, isPending: isConnectionPending } = useChatConnection();
	const { model, catalog } = useChatModelSelection();
	const { directory: composerDirectory } = useComposerContext();
	const sessionID = resolveServerSessionId({
		sessionId: session?.id,
		remoteId,
		threadId,
	});
	// A turn ending (or the chat changing) reads the usage again.
	const activityEpoch = useDomainState(
		Conversations,
		useCallback(
			(state: { chats: Record<string, ChatSummary> }) => {
				const chat = sessionID ? state.chats[sessionID] : undefined;
				return chat ? `${chat.updatedAt}:${chat.activity.status}` : "";
			},
			[sessionID],
		),
	);
	const directory = session?.directory ?? composerDirectory ?? connection?.globalDirectory ?? "";
	const tokens = useAuiState((state) =>
		lastAssistantTokens(state.thread.messages as readonly ThreadUsageMessage[]),
	);
	const fallback = useAuiState((state) =>
		fallbackTotalsFromMessages(state.thread.messages as readonly ThreadUsageMessage[]),
	);
	const assistantId = useAuiState((state) =>
		lastAssistantId(state.thread.messages as readonly ThreadUsageMessage[]),
	);
	const runCost = useAuiState((state) =>
		lastAssistantCost(state.thread.messages as readonly ThreadUsageMessage[]),
	);
	const contextWindow = catalog?.models.find(
		(entry) => entry.providerID === model?.providerID && entry.modelID === model?.modelID,
	)?.contextWindow;

	const usageQuery = useQuery({
		queryKey: [
			"kilo.chat",
			"session-model-usage",
			sessionID,
			directory,
			assistantId,
			isRunning,
			activityEpoch,
			connection?.baseUrl,
		],
		enabled:
			!isDraft &&
			!isConnectionPending &&
			connection !== undefined &&
			Boolean(sessionID) &&
			directory.length > 0,
		queryFn: async () => {
			if (!connection || !sessionID) return null;
			return (await fetchSessionModelUsage({ connection, directory, sessionID })) ?? null;
		},
		placeholderData: keepPreviousData,
		retry: false,
		refetchOnWindowFocus: false,
	});

	if (isDraft) return undefined;

	return toComposerUsageView({
		usage: usageQuery.data ?? undefined,
		fallback,
		...(tokens === undefined ? {} : { tokens }),
		contextWindow,
		catalog: catalog?.models,
		runCost,
	});
}
