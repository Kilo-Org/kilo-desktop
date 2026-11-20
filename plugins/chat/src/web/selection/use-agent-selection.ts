import { useEffect, useState } from "react";

import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import { DEFAULT_AGENT, findCatalogAgent, type KiloAgentCatalog } from "./agent-catalog";
import {
	ChatSelections,
	SelectionRecords,
	useSelectionRecords,
	type AgentSelectionState as AgentSelection,
} from "./chat-selections";

const DRAFT_SCOPE = "";

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
 * A chat's selection lives in the window's `ChatSelections` (`chats`), so it
 * survives its pane; a draft's lives in the hook.
 */
export function useAgentSelection(
	catalog: KiloAgentCatalog | undefined,
	threadId?: string,
	chats?: ChatSelections,
) {
	const scope = threadId ?? DRAFT_SCOPE;
	const [ownChats] = useState(() => new ChatSelections());
	const chatAgents = (chats ?? ownChats).agents;
	const [drafts] = useState(() => new SelectionRecords<AgentSelection>());
	const store = threadId === undefined ? drafts : chatAgents;
	const selections = useSelectionRecords(store);
	const selection = selections[scope] ?? DEFAULT_SELECTION;
	const selectedAgent = selection.agent;
	const selectedAgentRef = useLatestRef(selectedAgent);
	const catalogRef = useLatestRef(catalog);

	const setAgent = (nextAgent: string) => {
		selectedAgentRef.current = nextAgent;
		store.update((current) => ({
			...current,
			[scope]: { agent: nextAgent, dirty: true },
		}));
	};
	const getAgent = () => resolveAgentSelection(catalogRef.current, selectedAgentRef.current);
	const agent = resolveAgentSelection(catalog, selectedAgent);

	// Pin the selection to the agent it resolves to in the catalog. The
	// selection may live in the window's shared store, which a render must not write.
	useEffect(() => {
		if (!agent || agent === selectedAgent) return;
		store.update((current) => ({
			...current,
			[scope]: { agent, dirty: true },
		}));
	}, [agent, selectedAgent, scope, store]);

	const resetAgent = () => {
		setAgent(DEFAULT_AGENT);
	};
	const resetDraftAgent = () => {
		drafts.update((current) => ({
			...current,
			[DRAFT_SCOPE]: DEFAULT_SELECTION,
		}));
		if (!threadId) selectedAgentRef.current = DEFAULT_AGENT;
	};
	const hydrateThreadAgent = (id: string, nextAgent: string) => {
		chatAgents.update((current) => {
			const existing = current[id];
			if (existing?.dirty && existing.agent !== nextAgent) return current;
			if (existing?.agent === nextAgent && !existing.dirty) return current;
			return {
				...current,
				[id]: { agent: nextAgent, dirty: false },
			};
		});
	};
	const promoteDraftAgent = (id: string) => {
		const draft = drafts.getSnapshot()[DRAFT_SCOPE];
		chatAgents.update((current) => ({
			...current,
			[id]: draft ?? { agent: DEFAULT_AGENT, dirty: true },
		}));
	};

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
