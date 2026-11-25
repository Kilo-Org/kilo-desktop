import { useAuiState } from "@assistant-ui/react";

import { useOptionalOpenCodeSession } from "../runtime/use-optional-opencode-runtime-extras";
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
 * The composer's usage view: the session's billed totals, the latest step's
 * context fill and the last turn's cost.
 */
export function useComposerUsageView(): ComposerUsageView | undefined {
	const isDraft = useAuiState(
		(state) => state.thread.messages.length === 0 && state.threadListItem.status === "new",
	);
	const { model, catalog } = useChatModelSelection();
	const session = useOptionalOpenCodeSession();
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
		(entry) => entry.providerID === model?.providerID && entry.modelID === model?.id,
	)?.contextWindow;

	if (isDraft) return undefined;

	return toComposerUsageView({
		totals: session ? { cost: session.cost, tokens: session.tokens } : undefined,
		fallback,
		...(tokens === undefined ? {} : { tokens }),
		contextWindow,
		runCost,
	});
}
