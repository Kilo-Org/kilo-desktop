import { describe, expect, it } from "vitest";

import { discoverPlugins, type PluginDiscovery } from "@anaconda-agentic-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import {
	buildPluginZoneContributions,
	PLUGIN_ZONE_CONTRIBUTIONS,
	registerPluginZoneContributions,
} from "./plugin-zones";

const StatusItem = () => null;
const Card = () => null;

/**
 * Electron-only plugins (main entry, no browserRegister) yield non-browser-safe
 * widgets; pass electronOnly=false for a renderer-only (browser-safe) plugin.
 */
function makeDiscovery(electronOnly = true): PluginDiscovery {
	return discoverPlugins(
		[
			{
				manifest: {
					id: "demo",
					displayName: "Demo",
					version: "1.0.0",
					...(electronOnly ? { main: "./src/main/index.ts" } : {}),
					web: "./src/web/index.ts",
					contributes: {
						zones: [
							{ zone: "status-bar", component: "StatusItem", priority: 10 },
							{ zone: "dashboard", component: "Card", label: "Demo Card" },
						],
					},
				},
				module: electronOnly
					? { StatusItem, Card }
					: { browserRegister: () => {}, StatusItem, Card },
			},
		],
		"web",
	);
}

describe("buildPluginZoneContributions", () => {
	it("maps resolved zone widgets, defaulting label to the component name", () => {
		const contributions = buildPluginZoneContributions(makeDiscovery());

		expect(contributions).toEqual([
			{
				pluginId: "demo",
				zone: "status-bar",
				label: "StatusItem",
				component: StatusItem,
				priority: 10,
				browserSafe: false,
			},
			{
				pluginId: "demo",
				zone: "dashboard",
				label: "Demo Card",
				component: Card,
				priority: 0,
				browserSafe: false,
			},
		]);
	});
});

describe("registerPluginZoneContributions", () => {
	it("mounts contributions into the owning plugin's zones when desktop is available", () => {
		const sdk = createFakeSdk({ featureId: "demo" });
		const system = createFakeFeatureSystem({ sdks: { demo: sdk } });
		const contributions = buildPluginZoneContributions(makeDiscovery());

		const count = registerPluginZoneContributions(system, contributions, {
			desktopAvailable: true,
		});

		expect(count).toBe(2);
		const statusBar = system.services.contributionRegistry.getForZone("status-bar");
		expect(statusBar).toHaveLength(1);
		expect(statusBar[0]?.featureId).toBe("demo");
		expect(statusBar[0]?.component).toBe(StatusItem);
		expect(system.services.contributionRegistry.getForZone("dashboard")).toHaveLength(1);
	});

	it("skips Electron-only widgets in standalone browser mode", () => {
		const sdk = createFakeSdk({ featureId: "demo" });
		const system = createFakeFeatureSystem({ sdks: { demo: sdk } });
		const contributions = buildPluginZoneContributions(makeDiscovery());

		const count = registerPluginZoneContributions(system, contributions, {
			desktopAvailable: false,
		});

		expect(count).toBe(0);
		expect(system.services.contributionRegistry.getForZone("status-bar")).toEqual([]);
	});

	it("mounts browser-safe widgets even without desktop", () => {
		const sdk = createFakeSdk({ featureId: "demo" });
		const system = createFakeFeatureSystem({ sdks: { demo: sdk } });
		// No main entry → browserRegister present → browserSafe.
		const contributions = buildPluginZoneContributions(makeDiscovery(false));

		const count = registerPluginZoneContributions(system, contributions, {
			desktopAvailable: false,
		});

		expect(count).toBe(2);
	});
});

describe("PLUGIN_ZONE_CONTRIBUTIONS", () => {
	it("has no zone contributions from the bundled todos plugin", () => {
		expect(PLUGIN_ZONE_CONTRIBUTIONS.find((c) => c.pluginId === "todos")).toBeUndefined();
	});
});
