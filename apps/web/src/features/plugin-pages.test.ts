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
					contributes: {
						routes: [
							{ path: "/demo", component: "TodosPage", title: "Demo" },
							{ path: "/demo/stats", component: "StatsPage" },
						],
					},
				},
				module: { TodosPage, StatsPage },
			},
		],
		"web",
	);
}

describe("buildPluginPages", () => {
	it("derives renderable pages (path, title, splat) from resolved routes", () => {
		const pages = buildPluginPages(makeDiscovery());

		expect(pages).toEqual([
			{
				pluginId: "demo",
				path: "/plugins/demo",
				title: "Demo",
				component: TodosPage,
				browserSafe: false,
				splat: "demo",
			},
			{
				pluginId: "demo",
				path: "/plugins/demo/stats",
				title: undefined,
				component: StatsPage,
				browserSafe: false,
				splat: "demo/stats",
			},
		]);
	});
});

describe("findPluginPage", () => {
	it("finds a page by its exact resolved path", () => {
		const pages = buildPluginPages(makeDiscovery());
		expect(findPluginPage(pages, "/plugins/demo")?.title).toBe("Demo");
		expect(findPluginPage(pages, "/plugins/demo/stats")?.path).toBe("/plugins/demo/stats");
		expect(findPluginPage(pages, "/plugins/nope")).toBeUndefined();
	});
});

describe("PLUGIN_PAGES", () => {
	it("contains the bundled todos plugin page under the /plugins namespace", () => {
		const todos = findPluginPage(PLUGIN_PAGES, "/plugins/todos");
		expect(todos).toBeDefined();
		expect(todos?.pluginId).toBe("todos");
		expect(todos?.title).toBe("Todo List");
		expect(todos?.splat).toBe("todos");
		// Electron-only plugin: no browserRegister.
		expect(todos?.browserSafe).toBe(false);
	});

	it("contains the Kilo chat route without shell-owned companion UI", () => {
		const chat = findPluginPage(PLUGIN_PAGES, "/plugins/chat");
		expect(chat?.pluginId).toBe("kilo-ui");
	});
});
