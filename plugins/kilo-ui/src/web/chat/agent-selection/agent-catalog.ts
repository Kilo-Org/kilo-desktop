import type { Agent } from "@kilocode/sdk/v2/client";

/** Agent fields the switcher renders from `client.app.agents()`. */
export type KiloCatalogAgent = {
	name: string;
	displayName: string;
	color?: string;
};

export type KiloAgentCatalog = {
	agents: readonly KiloCatalogAgent[];
};

/** Kilo’s default coding agent — always the switcher default. */
export const DEFAULT_AGENT = "code";

const SWITCHER_AGENTS = [
	{ name: "code", displayName: "Code" },
	{ name: "plan", displayName: "Plan", color: "#f97316" },
	{ name: "ask", displayName: "Ask", color: "#22c55e" },
	{ name: "debug", displayName: "Debug", color: "#ef4444" },
] as const satisfies readonly KiloCatalogAgent[];

/**
 * Assumed switcher set while `app.agents` is still loading.
 * Used for the trigger and menu so selection works before the catalog arrives.
 */
export const OPTIMISTIC_AGENT_CATALOG: KiloAgentCatalog = {
	agents: SWITCHER_AGENTS,
};

/** Older Kilo builds used `build` for the coding agent. */
const AGENT_ALIASES: Record<string, string> = {
	build: "code",
};

function canonicalizeAgentName(name: string): string {
	return AGENT_ALIASES[name] ?? name;
}

function isSelectableAgent(agent: Pick<Agent, "mode" | "hidden" | "deprecated">): boolean {
	if (agent.hidden || agent.deprecated) {
		return false;
	}
	return agent.mode === "primary" || agent.mode === "all";
}

/** Keep only Code / Plan / Ask / Debug, in that order. */
export function buildAgentCatalog(agents: readonly Agent[]): KiloAgentCatalog {
	const available = new Set(
		agents.filter(isSelectableAgent).map((agent) => canonicalizeAgentName(agent.name)),
	);

	return {
		agents: SWITCHER_AGENTS.filter((agent) => available.has(agent.name)).map((agent) => ({
			name: agent.name,
			displayName: agent.displayName,
			...("color" in agent && agent.color !== undefined ? { color: agent.color } : {}),
		})),
	};
}

export function findCatalogAgent(
	catalog: KiloAgentCatalog | undefined,
	name: string | undefined,
): KiloCatalogAgent | undefined {
	if (!catalog || !name) {
		return undefined;
	}
	return catalog.agents.find((agent) => agent.name === name);
}
