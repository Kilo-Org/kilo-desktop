import { describe, expect, it } from "vitest";

import { discoverPlugins, type PluginDiscovery } from "@anaconda-agentic-desktop/feature-sdk";

import { buildPluginPages, findPluginPage, PLUGIN_PAGES } from "./plugin-pages";

const TodosPage = () => null;
const StatsPage = () => null;

function makeDiscovery(): PluginDiscovery {
	return discoverPlugins(
		[
			{
				manifest: {
					id: "demo",
					displayName: "Demo",
					version: "1.0.0",
					main: "./src/main/index.ts",
					web: "./src/web/index.ts",
					routes: [
						{ path: "/demo", label: "Demo", component: "TodosPage", icon: "list-todo" },
						{ path: "/demo/stats", label: "Demo Stats", component: "StatsPage" },
					],
				},
				module: { TodosPage, StatsPage },
			},
		],
		"web",
	);
}

describe("buildPluginPages", () => {
	it("derives renderable pages (splat + nav qa id) from resolved routes", () => {
		const pages = buildPluginPages(makeDiscovery());

		expect(pages).toEqual([
			{
				pluginId: "demo",
				path: "/demo",
				label: "Demo",
				icon: "list-todo",
				component: TodosPage,
				browserSafe: false,
				splat: "demo",
				navQaId: "nav-demo",
			},
			{
				pluginId: "demo",
				path: "/demo/stats",
				label: "Demo Stats",
				icon: undefined,
				component: StatsPage,
				browserSafe: false,
				splat: "demo/stats",
				navQaId: "nav-demo-stats",
			},
		]);
	});
});

describe("findPluginPage", () => {
	it("finds a page by its exact manifest path", () => {
		const pages = buildPluginPages(makeDiscovery());
		expect(findPluginPage(pages, "/demo")?.label).toBe("Demo");
		expect(findPluginPage(pages, "/demo/stats")?.label).toBe("Demo Stats");
		expect(findPluginPage(pages, "/nope")).toBeUndefined();
	});
});

describe("PLUGIN_PAGES", () => {
	it("contains the bundled todos plugin page from its manifest", () => {
		const todos = findPluginPage(PLUGIN_PAGES, "/todos");
		expect(todos).toBeDefined();
		expect(todos?.pluginId).toBe("todos");
		expect(todos?.label).toBe("Todo List");
		expect(todos?.icon).toBe("list-todo");
		expect(todos?.navQaId).toBe("nav-todos");
		// Electron-only plugin: no browserRegister.
		expect(todos?.browserSafe).toBe(false);
	});
});
