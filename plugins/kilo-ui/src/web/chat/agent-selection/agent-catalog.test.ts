import { describe, expect, it } from "vitest";
import type { Agent } from "@kilocode/sdk/v2/client";
import {
	BotIcon,
	BugIcon,
	HammerIcon,
	ListTodoIcon,
	MessageCircleQuestionMarkIcon,
} from "lucide-react";

import {
	buildAgentCatalog,
	cycleCatalogAgent,
	findCatalogAgent,
	isCssColor,
	OPTIMISTIC_AGENT_CATALOG,
	prettifyAgentId,
} from "./agent-catalog.js";

function agent(partial: Partial<Agent> & Pick<Agent, "name" | "mode">): Agent {
	return {
		permission: [],
		options: {},
		...partial,
	};
}

describe("agent-catalog", () => {
	it("keeps built-ins first in curated order, appends custom agents in server order", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "debug", mode: "primary" }),
			agent({ name: "ask", mode: "primary" }),
			agent({ name: "plan", mode: "primary" }),
			agent({ name: "code", mode: "primary" }),
			agent({ name: "explore", mode: "primary", displayName: "Explore" }),
			agent({ name: "orchestrator", mode: "primary" }),
			agent({ name: "ask", mode: "primary", hidden: true }),
		]);

		expect(catalog.agents).toEqual([
			{ name: "code", displayName: "Code", icon: HammerIcon },
			{ name: "plan", displayName: "Plan", color: "#f97316", icon: ListTodoIcon },
			{ name: "ask", displayName: "Ask", color: "#22c55e", icon: MessageCircleQuestionMarkIcon },
			{ name: "debug", displayName: "Debug", color: "#ef4444", icon: BugIcon },
			{ name: "explore", displayName: "Explore", icon: BotIcon },
			{ name: "orchestrator", displayName: "Orchestrator", icon: BotIcon },
		]);
	});

	it("preserves configured model and variant defaults for selectable agents", () => {
		const catalog = buildAgentCatalog([
			agent({
				name: "code",
				mode: "primary",
				model: { providerID: "anthropic", modelID: "claude-sonnet" },
				variant: "high",
			}),
			agent({
				name: "docs-writer",
				mode: "primary",
				model: { providerID: "anthropic", modelID: "claude-opus" },
			}),
		]);

		expect(findCatalogAgent(catalog, "code")).toMatchObject({
			model: { providerID: "anthropic", modelID: "claude-sonnet" },
			variant: "high",
		});
		expect(findCatalogAgent(catalog, "docs-writer")).toMatchObject({
			model: { providerID: "anthropic", modelID: "claude-opus" },
		});
	});

	it("aliases legacy build to code", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "build", mode: "primary" }),
			agent({ name: "plan", mode: "primary" }),
		]);
		expect(catalog.agents.map((entry) => entry.name)).toEqual(["code", "plan"]);
		expect(findCatalogAgent(catalog, "code")?.displayName).toBe("Code");
	});

	it("omits switcher agents that are missing or not selectable", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "plan", mode: "primary" }),
			agent({ name: "code", mode: "subagent" }),
			agent({ name: "debug", mode: "primary", deprecated: true }),
		]);
		expect(catalog.agents.map((entry) => entry.name)).toEqual(["plan"]);
	});

	it("exposes the full switcher set for optimistic first paint", () => {
		expect(OPTIMISTIC_AGENT_CATALOG.agents.map((entry) => entry.name)).toEqual([
			"code",
			"plan",
			"ask",
			"debug",
		]);
		expect(findCatalogAgent(OPTIMISTIC_AGENT_CATALOG, "code")?.displayName).toBe("Code");
	});

	it("cycles forward and wraps around the switcher", () => {
		expect(cycleCatalogAgent(OPTIMISTIC_AGENT_CATALOG, "code", 1)).toBe("plan");
		expect(cycleCatalogAgent(OPTIMISTIC_AGENT_CATALOG, "plan", 1)).toBe("ask");
		expect(cycleCatalogAgent(OPTIMISTIC_AGENT_CATALOG, "ask", 1)).toBe("debug");
		expect(cycleCatalogAgent(OPTIMISTIC_AGENT_CATALOG, "debug", 1)).toBe("code");
	});

	it("starts from the first agent when the current name is unknown", () => {
		expect(cycleCatalogAgent(OPTIMISTIC_AGENT_CATALOG, "missing", 1)).toBe("plan");
		expect(cycleCatalogAgent(undefined, "code", 1)).toBe("code");
	});

	it("excludes subagent and hidden agents from custom entries", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "code", mode: "primary" }),
			agent({ name: "docs-writer", mode: "primary" }),
			agent({ name: "orchestrator", mode: "subagent" }),
			agent({ name: "secret-agent", mode: "primary", hidden: true }),
			agent({ name: "old-agent", mode: "primary", deprecated: true }),
		]);
		expect(catalog.agents.map((entry) => entry.name)).toEqual(["code", "docs-writer"]);
	});

	it("uses server displayName and CSS color for custom agents", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "code", mode: "primary" }),
			agent({
				name: "docs-writer",
				mode: "primary",
				displayName: "Documentation Writer",
				color: "#8b5cf6",
			}),
		]);
		const custom = findCatalogAgent(catalog, "docs-writer");
		expect(custom?.displayName).toBe("Documentation Writer");
		expect(custom?.color).toBe("#8b5cf6");
		expect(custom?.icon).toBe(BotIcon);
	});

	it("drops non-CSS color values (CLI theme names)", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "code", mode: "primary" }),
			agent({ name: "my-agent", mode: "primary", color: "primary" }),
			agent({ name: "other-agent", mode: "primary", color: "accent" }),
			agent({ name: "valid-agent", mode: "primary", color: "rgb(100, 200, 50)" }),
		]);
		expect(findCatalogAgent(catalog, "my-agent")?.color).toBeUndefined();
		expect(findCatalogAgent(catalog, "other-agent")?.color).toBeUndefined();
		expect(findCatalogAgent(catalog, "valid-agent")?.color).toBe("rgb(100, 200, 50)");
	});

	it("prettifies hyphenated and underscored ids when no displayName is set", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "code", mode: "primary" }),
			agent({ name: "docs-writer", mode: "primary" }),
			agent({ name: "my_custom_agent", mode: "primary" }),
		]);
		expect(findCatalogAgent(catalog, "docs-writer")?.displayName).toBe("Docs Writer");
		expect(findCatalogAgent(catalog, "my_custom_agent")?.displayName).toBe("My Custom Agent");
	});

	it("does not duplicate when a custom agent has the same name as a built-in", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "code", mode: "primary", displayName: "Custom Code" }),
			agent({ name: "plan", mode: "primary" }),
		]);
		const names = catalog.agents.map((entry) => entry.name);
		expect(names).toEqual(["code", "plan"]);
		expect(findCatalogAgent(catalog, "code")?.displayName).toBe("Code");
	});

	describe("isCssColor", () => {
		it.each([
			["#fff", true],
			["#FF5733", true],
			["#ff573380", true],
			["rgb(255, 0, 0)", true],
			["rgba(255, 0, 0, 0.5)", true],
			["hsl(120, 100%, 50%)", true],
			["hsla(120, 100%, 50%, 0.3)", true],
			["oklch(0.7 0.15 180)", true],
			["oklab(0.5 -0.1 0.1)", true],
			["color(display-p3 1 0 0)", true],
			["var(--my-color)", true],
			["primary", false],
			["accent", false],
			["success", false],
			["red", false],
			// Malformed tails and invalid hex lengths must be rejected (full-match).
			["rgb(0,0,0)) } body{color:red}", false],
			["var(--x)); evil", false],
			["#12345", false],
			["#1234567", false],
			["#fff extra", false],
			["", false],
			[undefined, false],
		])("isCssColor(%j) → %s", (input, expected) => {
			expect(isCssColor(input)).toBe(expected);
		});
	});

	describe("prettifyAgentId", () => {
		it.each([
			["docs-writer", "Docs Writer"],
			["my_agent", "My Agent"],
			["simple", "Simple"],
			["multi-word-agent-name", "Multi Word Agent Name"],
			["snake_case_name", "Snake Case Name"],
		])("prettifyAgentId(%j) → %j", (input, expected) => {
			expect(prettifyAgentId(input)).toBe(expected);
		});
	});
});
