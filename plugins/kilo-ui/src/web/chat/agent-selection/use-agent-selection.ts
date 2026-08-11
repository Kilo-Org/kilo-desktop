import { useCallback, useEffect, useRef, useState } from "react";

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
	const [selectedAgent, setSelectedAgent] = useState(DEFAULT_AGENT);
	const selectedAgentRef = useRef(selectedAgent);
	const catalogRef = useRef(catalog);
	catalogRef.current = catalog;

	const setAgent = useCallback((nextAgent: string) => {
		selectedAgentRef.current = nextAgent;
		setSelectedAgent(nextAgent);
	}, []);
	const getAgent = useCallback(
		() => resolveAgentSelection(catalogRef.current, selectedAgentRef.current),
		[],
	);
	const agent = resolveAgentSelection(catalog, selectedAgent);

	useEffect(() => {
		if (agent && agent !== selectedAgent) {
			setAgent(agent);
		}
	}, [agent, selectedAgent]);

	const resetAgent = useCallback(() => {
		setAgent(DEFAULT_AGENT);
	}, [setAgent]);

	return {
		agent,
		getAgent,
		setAgent,
		resetAgent,
	};
}
