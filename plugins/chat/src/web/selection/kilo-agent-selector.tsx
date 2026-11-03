import type { ComposerActionImplementation, ComposerActionMenu } from "../../contracts";
import { useChatAgentSelection } from "./ChatAgentSelectionContext";
import { findCatalogAgent, OPTIMISTIC_AGENT_CATALOG } from "./agent-catalog";

/** The agent picker's menu: the agents Kilo offers, with their colours. */
export function useAgentMenu(): ComposerActionMenu {
	const { agent, setAgent, catalog, isCatalogPending, isCatalogError } = useChatAgentSelection();
	const displayCatalog = catalog ?? (isCatalogPending ? OPTIMISTIC_AGENT_CATALOG : undefined);
	const agents = displayCatalog?.agents ?? [];
	const selected = findCatalogAgent(displayCatalog, agent);
	return {
		label: selected?.displayName ?? <span className="text-muted-foreground">Select agent</span>,
		...(selected ? { icon: selected.icon } : {}),
		...(selected?.color ? { color: selected.color } : {}),
		ariaLabel: "Select agent",
		busy: isCatalogPending,
		disabled: isCatalogError || agents.length === 0,
		...(agent === undefined ? {} : { value: agent }),
		items: agents.map((entry) => ({
			id: entry.name,
			label: entry.displayName,
			icon: entry.icon,
			...(entry.color ? { color: entry.color } : {}),
		})),
		select: setAgent,
	};
}

/** kilo.chat's agent picker, through its own `composer-action` point. */
export const agentAction: ComposerActionImplementation = { kind: "menu", useMenu: useAgentMenu };
