import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_AGENT, findCatalogAgent, type KiloAgentCatalog } from "./agent-catalog.js";

type AgentSelection = {
	agent: string;
	dirty: boolean;
};

const DEFAULT_SELECTION: AgentSelection = {
	agent: DEFAULT_AGENT,
	dirty: false,
};

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
 * Thread-scoped agent selection hydrated from Kilo session state.
 * Unsent overrides stay in memory until Kilo persists them with the next prompt.
 */
export function useAgentSelection(catalog: KiloAgentCatalog | undefined, threadId?: string) {
	const scope = threadId ?? "";
	const [selections, setSelections] = useState<Record<string, AgentSelection>>({});
	const selection = selections[scope] ?? DEFAULT_SELECTION;
	const selectedAgent = selection.agent;
	const selectedAgentRef = useRef(selectedAgent);
	selectedAgentRef.current = selectedAgent;
	const catalogRef = useRef(catalog);
	catalogRef.current = catalog;

	const setAgent = useCallback(
		(nextAgent: string) => {
			selectedAgentRef.current = nextAgent;
			setSelections((current) => ({
				...current,
				[scope]: { agent: nextAgent, dirty: true },
			}));
		},
		[scope],
	);
	const getAgent = useCallback(
		() => resolveAgentSelection(catalogRef.current, selectedAgentRef.current),
		[],
	);
	const agent = resolveAgentSelection(catalog, selectedAgent);

	useEffect(() => {
		if (agent && agent !== selectedAgent) {
			setAgent(agent);
		}
	}, [agent, selectedAgent, setAgent]);

	const resetAgent = useCallback(() => {
		setAgent(DEFAULT_AGENT);
	}, [setAgent]);
	const resetDraftAgent = useCallback(() => {
		setSelections((current) => ({
			...current,
			"": DEFAULT_SELECTION,
		}));
		if (!threadId) selectedAgentRef.current = DEFAULT_AGENT;
	}, [threadId]);
	const hydrateThreadAgent = useCallback((id: string, nextAgent: string) => {
		setSelections((current) => {
			const existing = current[id];
			if (existing?.dirty && existing.agent !== nextAgent) return current;
			if (existing?.agent === nextAgent && !existing.dirty) return current;
			return {
				...current,
				[id]: { agent: nextAgent, dirty: false },
			};
		});
	}, []);
	const promoteDraftAgent = useCallback((id: string) => {
		setSelections((current) => ({
			...current,
			[id]: current[""] ?? { agent: DEFAULT_AGENT, dirty: true },
		}));
	}, []);

	return {
		agent,
		getAgent,
		setAgent,
		resetAgent,
		resetDraftAgent,
		hydrateThreadAgent,
		promoteDraftAgent,
	};
}
