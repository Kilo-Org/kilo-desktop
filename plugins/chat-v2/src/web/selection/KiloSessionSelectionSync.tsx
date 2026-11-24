import { useAuiState } from "@assistant-ui/react";
import { useEffect } from "react";

import type { KiloModelRef } from "../selection/model-catalog";
import { useOptionalOpenCodeSession } from "../runtime/use-optional-opencode-runtime-extras";

type KiloSessionSelectionSyncProps = {
	hydrateAgent: (threadId: string, agent: string) => void;
	hydrateModel: (
		threadId: string,
		selection: { agent: string; model: KiloModelRef; effort?: string },
	) => void;
	/** Kilo's session was read and records no model. */
	markLoaded: (threadId: string) => void;
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
	markLoaded,
}: KiloSessionSelectionSyncProps) {
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const session = useOptionalOpenCodeSession();
	const sessionId = session?.id;
	const agent = session?.agent;
	const providerID = session?.model?.providerID;
	const modelID = session?.model?.id;
	const effort = normalizeVariant(session?.model?.variant);

	// Syncs the parent's selection with Kilo's session, an external store the runtime owns that
	// only resolves below the runtime provider; the parent keeps local overrides authoritative.
	useEffect(() => {
		if (!remoteId || remoteId !== sessionId) return;
		// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
		if (agent) hydrateAgent(remoteId, agent);
		if (agent && providerID && modelID) {
			// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
			hydrateModel(remoteId, {
				agent,
				model: { providerID, modelID },
				...(effort ? { effort } : {}),
			});
		} else {
			// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
			markLoaded(remoteId);
		}
	}, [
		agent,
		effort,
		hydrateAgent,
		hydrateModel,
		markLoaded,
		modelID,
		providerID,
		remoteId,
		sessionId,
	]);

	return null;
}
