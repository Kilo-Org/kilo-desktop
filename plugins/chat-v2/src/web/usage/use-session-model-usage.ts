import { useAuiState } from "@assistant-ui/react";

import { useChatModelSelection } from "../selection/ChatModelSelectionContext";
import {
	fallbackTotalsFromMessages,
	lastAssistantCost,
	lastAssistantTokens,
	toComposerUsageView,
	type ComposerUsageView,
	type ThreadUsageMessage,
} from "./session-model-usage";

/**
 * The composer's usage view from the transcript alone. On Kilo v2 there is no
 * per-session usage route, so the per-model cost breakdown is hidden
 * (decision) and the totals come from the thread's own step costs and tokens.
 */
export function useComposerUsageView(): ComposerUsageView | undefined {
	const isDraft = useAuiState(
		(state) => state.thread.messages.length === 0 && state.threadListItem.status === "new",
	);
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
		usage: undefined,
		fallback,
		...(tokens === undefined ? {} : { tokens }),
		contextWindow,
		catalog: catalog?.models,
		runCost,
	});
}
