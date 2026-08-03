import { describe, expect, it } from "vitest";

import { discoverPlugins, type PluginDiscovery } from "@anaconda-agentic-desktop/feature-sdk";

import { buildPluginNav, PLUGIN_NAV } from "./plugin-nav";

const Page = () => null;

function makeDiscovery(): PluginDiscovery {
	return discoverPlugins(
		[
			{
				manifest: {
					id: "demo",
					displayName: "Demo",
					version: "1.0.0",
					web: "./src/web/index.ts",
					contributes: {
						routes: [{ path: "/demo", component: "Page" }],
						nav: [
							{ to: "/demo", label: "Demo", icon: "list-todo", priority: 1 },
							{ to: "/demo/stats", label: "Stats", priority: 10 },
						],
					},
				},
				module: { Page },
			},
		],
		"web",
	);
}

describe("buildPluginNav", () => {
	it("derives priority-ordered nav entries (splat + qa id) as pure data", () => {
		const nav = buildPluginNav(makeDiscovery());

		// Higher priority first: Stats (10) before Demo (1).
		expect(nav).toEqual([
			{
				pluginId: "demo",
				to: "/demo/stats",
				label: "Stats",
				icon: undefined,
				priority: 10,
				splat: "demo/stats",
				navQaId: "nav-demo-stats",
			},
			{
				pluginId: "demo",
				to: "/demo",
				label: "Demo",
				icon: "list-todo",
				priority: 1,
				splat: "demo",
				navQaId: "nav-demo",
			},
		]);
	});
});

describe("PLUGIN_NAV", () => {
	it("contains the bundled todos nav entry from its manifest", () => {
		const todos = PLUGIN_NAV.find((entry) => entry.to === "/todos");
		expect(todos).toBeDefined();
		expect(todos?.pluginId).toBe("todos");
		expect(todos?.label).toBe("Todo List");
		expect(todos?.icon).toBe("list-todo");
		expect(todos?.navQaId).toBe("nav-todos");
	});
});
