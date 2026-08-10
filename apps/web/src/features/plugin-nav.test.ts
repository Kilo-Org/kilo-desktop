import { describe, expect, it } from "vitest";

import { discoverPlugins, type PluginDiscovery } from "@anaconda-agentic-desktop/feature-sdk";

import { buildPluginNav, PLUGIN_NAV } from "./plugin-nav";

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
							{ to: "/demo/stats", label: "Stats", priority: 10 },
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

describe("PLUGIN_NAV", () => {
	it("contains the bundled environments nav entry under the /plugins namespace", () => {
		const environments = PLUGIN_NAV.find((entry) => entry.to === "/plugins/environments");
		expect(environments).toBeDefined();
		expect(environments?.pluginId).toBe("environments");
		expect(environments?.label).toBe("Environments");
		expect(environments?.icon).toBe("EnvironmentsNavIcon");
		expect(environments?.iconComponent).toBeDefined();
		expect(environments?.navQaId).toBe("nav-environments");
	});

	it("does not include the todos plugin in the sidebar", () => {
		expect(PLUGIN_NAV.find((entry) => entry.pluginId === "todos")).toBeUndefined();
	});
});
