import { useAuiState } from "@assistant-ui/react";
import { useEffect } from "react";

import type { KiloModelRef } from "../model-selection/model-catalog.js";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras.js";

type KiloSessionSelectionSyncProps = {
	hydrateAgent: (threadId: string, agent: string) => void;
	hydrateModel: (
		threadId: string,
		selection: { agent: string; model: KiloModelRef; effort?: string },
	) => void;
};

function normalizeVariant(variant: string | undefined): string | undefined {
	return variant && variant !== "default" ? variant : undefined;
}

/**
 * Mirrors Kilo's canonical per-session agent/model into the composer selectors.
 * Local unsent overrides remain authoritative until the next prompt persists them.
 */
export function KiloSessionSelectionSync({
	hydrateAgent,
	hydrateModel,
}: KiloSessionSelectionSyncProps) {
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const session = useOptionalOpenCodeRuntimeExtras()?.session;
	const sessionId = session?.id;
	const agent = session?.agent;
	const providerID = session?.model?.providerID;
	const modelID = session?.model?.id;
	const effort = normalizeVariant(session?.model?.variant);

	useEffect(() => {
		if (!remoteId || remoteId !== sessionId) return;
		if (agent) hydrateAgent(remoteId, agent);
		if (agent && providerID && modelID) {
			hydrateModel(remoteId, {
				agent,
				model: { providerID, modelID },
				...(effort ? { effort } : {}),
			});
		}
	}, [agent, effort, hydrateAgent, hydrateModel, modelID, providerID, remoteId, sessionId]);

	return null;
}
