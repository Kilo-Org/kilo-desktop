import { useCallback, useEffect, useState } from "react";

import { DEFAULT_AGENT, findCatalogAgent, type KiloAgentCatalog } from "./agent-catalog.js";

export function resolveAgentSelection(
	catalog: KiloAgentCatalog | undefined,
	selectedAgent: string,
): string | undefined {
	if (!catalog) return selectedAgent;
	return (
		findCatalogAgent(catalog, selectedAgent)?.name ??
		findCatalogAgent(catalog, DEFAULT_AGENT)?.name ??
		catalog.agents[0]?.name
	);
}

/**
 * Ephemeral agent for the active draft/session.
 * Prefers Code on start/reset and falls back to the first available agent.
 */
export function useAgentSelection(catalog: KiloAgentCatalog | undefined) {
	const [selectedAgent, setAgent] = useState(DEFAULT_AGENT);
	const agent = resolveAgentSelection(catalog, selectedAgent);

	useEffect(() => {
		if (agent && agent !== selectedAgent) {
			setAgent(agent);
		}
	}, [agent, selectedAgent]);

	const resetAgent = useCallback(() => {
		setAgent(DEFAULT_AGENT);
	}, []);

	return {
		agent,
		setAgent,
		resetAgent,
	};
}
