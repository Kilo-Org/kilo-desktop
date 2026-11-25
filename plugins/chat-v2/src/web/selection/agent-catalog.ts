import type { AgentInfo } from "@kilo-desktop/react-opencode-v2";
import {
	BotIcon,
	BugIcon,
	HammerIcon,
	ListTodoIcon,
	MessageCircleQuestionMarkIcon,
	type LucideIcon,
} from "lucide-react";

/** An agent as the switcher renders it, from Kilo's `agent.list`. */
export type KiloCatalogAgent = {
	name: string;
	displayName: string;
	icon: LucideIcon;
	color?: string;
	model?: { providerID: string; modelID: string };
	variant?: string;
};

export type KiloAgentCatalog = {
	agents: readonly KiloCatalogAgent[];
};

/** Kilo’s default coding agent — always the switcher default. */
export const DEFAULT_AGENT = "code";

const SWITCHER_AGENTS = [
	{ name: "code", displayName: "Code", icon: HammerIcon },
	{ name: "plan", displayName: "Plan", color: "#f97316", icon: ListTodoIcon },
	{ name: "ask", displayName: "Ask", color: "#22c55e", icon: MessageCircleQuestionMarkIcon },
	{ name: "debug", displayName: "Debug", color: "#ef4444", icon: BugIcon },
] as const satisfies readonly KiloCatalogAgent[];

/**
 * Assumed switcher set while `agent.list` is still loading.
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

function isSelectableAgent(agent: Pick<AgentInfo, "mode" | "hidden">): boolean {
	if (agent.hidden) {
		return false;
	}
	return agent.mode === "primary" || agent.mode === "all";
}

const HEX_COLOR_RE = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const FUNCTIONAL_COLOR_RE = /^(?:rgb|hsl|okl(?:ab|ch)|lab|lch|color|hwb)a?\([^)]*\)$/i;
const VAR_COLOR_RE = /^var\(--[^)]*\)$/i;

/** Returns true when a color string is a CSS-resolvable value the renderer can use. */
export function isCssColor(value: string | undefined): value is string {
	if (!value) return false;
	return HEX_COLOR_RE.test(value) || FUNCTIONAL_COLOR_RE.test(value) || VAR_COLOR_RE.test(value);
}

/**
 * Prettify a kebab/snake/space-delimited agent id into a display name.
 * "docs-writer" → "Docs Writer", "my_agent" → "My Agent"
 */
function prettifyAgentId(id: string): string {
	return id
		.split(/[-_\s]+/)
		.map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : ""))
		.join(" ");
}

/**
 * Build the catalog from the server's agent list (`id` is what a session
 * switches to, `name` what it shows).
 * Curated built-ins appear first in their fixed order, followed by any
 * additional selectable custom agents in server order.
 */
export function buildAgentCatalog(agents: readonly AgentInfo[]): KiloAgentCatalog {
	const selectable = agents.filter(isSelectableAgent);
	const available = new Map(
		selectable.map((agent) => [canonicalizeAgentName(agent.id), agent] as const),
	);
	const builtInNames: Set<string> = new Set(SWITCHER_AGENTS.map((entry) => entry.name));

	const configuredDefaults = (agent: AgentInfo) => ({
		...(agent.model
			? { model: { providerID: agent.model.providerID, modelID: agent.model.id } }
			: {}),
		...(agent.model?.variant ? { variant: agent.model.variant } : {}),
	});
	const builtIns = SWITCHER_AGENTS.flatMap((entry) => {
		const source = available.get(entry.name);
		return source ? [{ ...entry, ...configuredDefaults(source) }] : [];
	});

	const seen: Set<string> = new Set(builtInNames);
	const custom: KiloCatalogAgent[] = [];
	for (const agent of selectable) {
		const name = canonicalizeAgentName(agent.id);
		if (seen.has(name)) continue;
		seen.add(name);
		const color = isCssColor(agent.color) ? agent.color : undefined;
		custom.push({
			name,
			// An agent without a display name of its own is named by its id.
			displayName: agent.name && agent.name !== agent.id ? agent.name : prettifyAgentId(name),
			icon: BotIcon,
			...(color ? { color } : {}),
			...configuredDefaults(agent),
		});
	}

	return { agents: [...builtIns, ...custom] };
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
