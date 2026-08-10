import { describe, expect, it } from "vitest";
import type { Agent } from "@kilocode/sdk/v2/client";
import { BugIcon, HammerIcon, ListTodoIcon, MessageCircleQuestionIcon } from "lucide-react";

import { buildAgentCatalog, findCatalogAgent, OPTIMISTIC_AGENT_CATALOG } from "./agent-catalog.js";

function agent(partial: Partial<Agent> & Pick<Agent, "name" | "mode">): Agent {
	return {
		permission: [],
		options: {},
		...partial,
	};
}

describe("agent-catalog", () => {
	it("keeps Code, Plan, Ask, Debug in order and drops everything else", () => {
		const catalog = buildAgentCatalog([
			agent({ name: "debug", mode: "primary" }),
			agent({ name: "ask", mode: "primary" }),
			agent({ name: "plan", mode: "primary" }),
			agent({ name: "code", mode: "primary" }),
			agent({ name: "explore", mode: "primary" }),
			agent({ name: "orchestrator", mode: "primary" }),
			agent({ name: "ask", mode: "primary", hidden: true }),
		]);

		expect(catalog.agents).toEqual([
			{ name: "code", displayName: "Code", icon: HammerIcon },
			{ name: "plan", displayName: "Plan", color: "#f97316", icon: ListTodoIcon },
			{ name: "ask", displayName: "Ask", color: "#22c55e", icon: MessageCircleQuestionIcon },
			{ name: "debug", displayName: "Debug", color: "#ef4444", icon: BugIcon },
		]);
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
});
