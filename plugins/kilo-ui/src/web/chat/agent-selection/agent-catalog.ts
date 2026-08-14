import type { Agent } from "@kilocode/sdk/v2/client";
import {
	BugIcon,
	HammerIcon,
	ListTodoIcon,
	MessageCircleQuestionIcon,
	type LucideIcon,
} from "lucide-react";

/** Agent fields the switcher renders from `client.app.agents()`. */
export type KiloCatalogAgent = {
	name: string;
	displayName: string;
	icon: LucideIcon;
	color?: string;
};

export type KiloAgentCatalog = {
	agents: readonly KiloCatalogAgent[];
};

/** Kilo’s default coding agent — always the switcher default. */
export const DEFAULT_AGENT = "code";

const SWITCHER_AGENTS = [
	{ name: "code", displayName: "Code", icon: HammerIcon },
	{ name: "plan", displayName: "Plan", color: "#f97316", icon: ListTodoIcon },
	{ name: "ask", displayName: "Ask", color: "#22c55e", icon: MessageCircleQuestionIcon },
	{ name: "debug", displayName: "Debug", color: "#ef4444", icon: BugIcon },
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
		agents: SWITCHER_AGENTS.filter((agent) => available.has(agent.name)),
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

/** Next/previous switcher agent, wrapping at the ends. */
export function cycleCatalogAgent(
	catalog: KiloAgentCatalog | undefined,
	current: string | undefined,
	direction: 1 | -1,
): string | undefined {
	const agents = catalog?.agents ?? [];
	if (agents.length === 0) {
		return current;
	}

	const index = agents.findIndex((entry) => entry.name === current);
	const from = index === -1 ? 0 : index;
	const next = (from + direction + agents.length) % agents.length;
	return agents[next]?.name;
}
