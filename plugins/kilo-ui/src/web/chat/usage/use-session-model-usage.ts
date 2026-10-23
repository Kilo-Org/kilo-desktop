import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuiState } from "@assistant-ui/react";

import { useChatConnection } from "../connection/ChatConnectionContext.js";
import { useChatModelSelection } from "../model-selection/ChatModelSelectionContext.js";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras.js";
import { useOptionalSessionActivity } from "../../session/activity/SessionActivityProvider.js";
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
} from "./session-model-usage.js";

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
	const activityEpoch = useOptionalSessionActivity((state) => state.activityEpoch);
	const activityDirectory = useOptionalSessionActivity((state) => {
		const sessionId = resolveServerSessionId({
			sessionId: session?.id,
			remoteId,
			threadId,
		});
		return sessionId ? state.sessions[sessionId]?.directory : undefined;
	});

	const sessionID = resolveServerSessionId({
		sessionId: session?.id,
		remoteId,
		threadId,
	});
	const directory = session?.directory ?? activityDirectory ?? connection?.globalDirectory ?? "";
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
			"kilo-ui",
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
