import { useAuiState } from "@assistant-ui/react";
import type { OpenCodeRuntimeExtras } from "@kilo-desktop/react-opencode";

import { useOpenCodeExtrasSlice } from "../runtime/use-optional-opencode-runtime-extras";
import { useChatModelSelection } from "../selection/ChatModelSelectionContext";
import {
	fallbackTotalsFromMessages,
	lastAssistantCost,
	lastAssistantTokens,
	sessionModelUsageOf,
	toComposerUsageView,
	type ComposerUsageView,
	type SessionModelUsage,
	type ThreadUsageMessage,
} from "./session-model-usage";

const usageByState = new WeakMap<object, SessionModelUsage>();

/** The thread's usage, kept per thread state so a re-render reads the same object. */
function selectUsage(extras: OpenCodeRuntimeExtras): SessionModelUsage {
	let usage = usageByState.get(extras.state);
	if (!usage) {
		usage = sessionModelUsageOf(extras.state);
		usageByState.set(extras.state, usage);
	}
	return usage;
}

export function useComposerUsageView(): ComposerUsageView | undefined {
	const isDraft = useAuiState(
		(state) => state.thread.messages.length === 0 && state.threadListItem.status === "new",
	);
	const usage = useOpenCodeExtrasSlice(selectUsage);
	const { model, catalog } = useChatModelSelection();
	const tokens = useAuiState((state) =>
		lastAssistantTokens(state.thread.messages as readonly ThreadUsageMessage[]),
	);
	const fallback = useAuiState((state) =>
		fallbackTotalsFromMessages(state.thread.messages as readonly ThreadUsageMessage[]),
	);
	const runCost = useAuiState((state) =>
		lastAssistantCost(state.thread.messages as readonly ThreadUsageMessage[]),
	);
	const contextWindow = catalog?.models.find(
		(entry) => entry.providerID === model?.providerID && entry.modelID === model?.modelID,
	)?.contextWindow;

	if (isDraft) return undefined;

	return toComposerUsageView({
		usage,
		fallback,
		...(tokens === undefined ? {} : { tokens }),
		contextWindow,
		catalog: catalog?.models,
		runCost,
	});
}
