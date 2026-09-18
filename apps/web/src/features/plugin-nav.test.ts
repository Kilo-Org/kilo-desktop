import { describe, expect, it } from "vitest";

import { discoverPlugins, type PluginDiscovery } from "@kilo-desktop/feature-sdk";

import { PLUGIN_NAV } from "./plugin-nav-entries";
import { buildPluginNav, filterVisiblePluginNav } from "./plugin-nav";

const Page = () => null;
const DemoNavIcon = () => null;

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
							{ to: "/demo", label: "Demo", icon: "DemoNavIcon", priority: 1 },
							{
								to: "/demo/stats",
								label: "Stats",
								priority: 10,
								featureFlag: "demo-stats",
							},
						],
					},
				},
				module: { Page, DemoNavIcon },
			},
		],
		"web",
	);
}

describe("buildPluginNav", () => {
	it("derives priority-ordered nav entries with resolved /plugins paths", () => {
		const nav = buildPluginNav(makeDiscovery());

		// Higher priority first: Stats (10) before Demo (1).
		expect(nav).toEqual([
			{
				pluginId: "demo",
				to: "/plugins/demo/stats",
				label: "Stats",
				icon: undefined,
				iconComponent: undefined,
				priority: 10,
				splat: "demo/stats",
				navQaId: "nav-demo-stats",
				featureFlag: "demo-stats",
			},
			{
				pluginId: "demo",
				to: "/plugins/demo",
				label: "Demo",
				icon: "DemoNavIcon",
				iconComponent: DemoNavIcon,
				priority: 1,
				splat: "demo",
				navQaId: "nav-demo",
				featureFlag: undefined,
			},
		]);
	});

	it("resolves iconComponent from module exports (component takes priority)", () => {
		const nav = buildPluginNav(makeDiscovery());
		const demoEntry = nav.find((e) => e.label === "Demo");
		expect(demoEntry?.iconComponent).toBe(DemoNavIcon);
	});

	it("leaves iconComponent undefined when icon does not match a module export", () => {
		const nav = buildPluginNav(makeDiscovery());
		const statsEntry = nav.find((e) => e.label === "Stats");
		expect(statsEntry?.iconComponent).toBeUndefined();
	});
});

describe("filterVisiblePluginNav", () => {
	const nav = buildPluginNav(makeDiscovery());

	it("keeps entries without a featureFlag regardless of flag map", () => {
		expect(filterVisiblePluginNav(nav, {}).map((e) => e.label)).toContain("Demo");
	});

	it("hides entries whose gating flag is missing or falsy", () => {
		const labels = filterVisiblePluginNav(nav, {}).map((e) => e.label);
		expect(labels).not.toContain("Stats");

		const labelsExplicitFalse = filterVisiblePluginNav(nav, { "demo-stats": false }).map(
			(e) => e.label,
		);
		expect(labelsExplicitFalse).not.toContain("Stats");
	});

	it("shows entries whose gating flag is truthy", () => {
		const labels = filterVisiblePluginNav(nav, { "demo-stats": true }).map((e) => e.label);
		expect(labels).toContain("Stats");
	});
});

describe("PLUGIN_NAV", () => {
	it("contains the bundled todos nav entry under the /plugins namespace", () => {
		const todos = PLUGIN_NAV.find((entry) => entry.to === "/plugins/todos");
		expect(todos).toBeDefined();
		expect(todos?.pluginId).toBe("todos");
		expect(todos?.label).toBe("Todo List");
		expect(todos?.icon).toBe("TodoNavIcon");
		expect(todos?.iconComponent).toBeDefined();
		expect(todos?.navQaId).toBe("nav-todos");
		expect(todos?.featureFlag).toBe("todo-feature");
	});

	it("does not contain an environments nav entry (moved to settings)", () => {
		const environments = PLUGIN_NAV.find((entry) => entry.to === "/plugins/environments");
		expect(environments).toBeUndefined();
	});
});
