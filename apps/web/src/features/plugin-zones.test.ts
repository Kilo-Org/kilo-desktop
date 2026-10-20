import { describe, expect, it } from "vitest";

import { discoverPlugins, type PluginDiscovery } from "@kilo-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import {
	buildPluginZoneContributions,
	PLUGIN_ZONE_CONTRIBUTIONS,
	registerPluginZoneContributions,
} from "./plugin-zones";

const StatusItem = () => null;
const Card = () => null;
const Panel = () => null;
const PanelIcon = () => null;

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

function makePluginOwnedZoneDiscovery(electronOnly = false): PluginDiscovery {
	return discoverPlugins(
		[
			{
				manifest: {
					id: "host",
					displayName: "Host",
					version: "1.0.0",
					web: "./src/web/index.ts",
					zones: [{ id: "detail-panel" }],
				},
				module: {},
			},
			{
				manifest: {
					id: "contributor",
					displayName: "Contributor",
					version: "1.0.0",
					...(electronOnly ? { main: "./src/main/index.ts" } : {}),
					web: "./src/web/index.ts",
					contributes: {
						zones: [
							{
								zone: "host/detail-panel",
								id: "panel",
								component: "Panel",
								label: "Panel",
								description: "Open panel.",
								icon: "PanelIcon",
								mountPolicy: "keep-alive",
								priority: 10,
							},
						],
					},
				},
				module: { Panel, PanelIcon },
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
				id: "StatusItem",
				zone: "status-bar",
				label: "StatusItem",
				component: StatusItem,
				priority: 10,
				browserSafe: false,
			},
			{
				pluginId: "demo",
				id: "Card",
				zone: "dashboard",
				label: "Demo Card",
				component: Card,
				priority: 0,
				browserSafe: false,
			},
		]);
	});

	it("maps contributions to plugin-owned zones with host metadata", () => {
		expect(buildPluginZoneContributions(makePluginOwnedZoneDiscovery())).toEqual([
			{
				pluginId: "contributor",
				id: "panel",
				zone: "host/detail-panel",
				label: "Panel",
				description: "Open panel.",
				component: Panel,
				icon: PanelIcon,
				mountPolicy: "keep-alive",
				priority: 10,
				browserSafe: true,
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

	it("registers plugin-owned zones through the existing zone path", () => {
		const contributorSdk = createFakeSdk({ featureId: "contributor" });
		const system = createFakeFeatureSystem({ sdks: { contributor: contributorSdk } });
		const contributions = buildPluginZoneContributions(makePluginOwnedZoneDiscovery());

		expect(
			registerPluginZoneContributions(system, contributions, { desktopAvailable: false }),
		).toBe(1);
		expect(system.services.contributionRegistry.getForZone("host/detail-panel")).toMatchObject([
			{
				featureId: "contributor",
				id: "panel",
				label: "Panel",
				description: "Open panel.",
				component: Panel,
				icon: PanelIcon,
				mountPolicy: "keep-alive",
				priority: 10,
			},
		]);
	});

	it("skips Electron-only plugin-owned zone contributions in browser mode", () => {
		const contributorSdk = createFakeSdk({ featureId: "contributor" });
		const system = createFakeFeatureSystem({ sdks: { contributor: contributorSdk } });
		const contributions = buildPluginZoneContributions(makePluginOwnedZoneDiscovery(true));

		expect(
			registerPluginZoneContributions(system, contributions, { desktopAvailable: false }),
		).toBe(0);
	});
});

describe("PLUGIN_ZONE_CONTRIBUTIONS", () => {
	it("has no zone contributions from the bundled todos plugin", () => {
		expect(PLUGIN_ZONE_CONTRIBUTIONS.find((c) => c.pluginId === "todos")).toBeUndefined();
	});

	it("includes kilo-ui SessionList in the sidebar zone", () => {
		const contribution = PLUGIN_ZONE_CONTRIBUTIONS.find(
			(c) => c.pluginId === "kilo-ui" && c.zone === "sidebar",
		);
		expect(contribution).toMatchObject({
			pluginId: "kilo-ui",
			zone: "sidebar",
			label: "Sessions",
			priority: 10,
		});
		expect(contribution?.component).toBeTypeOf("function");
	});

	it("does not contribute kilo-ui search to the sidebar header", () => {
		const contribution = PLUGIN_ZONE_CONTRIBUTIONS.find(
			(c) => c.pluginId === "kilo-ui" && c.zone === "sidebar-header-actions",
		);
		expect(contribution).toBeUndefined();
	});

	it("includes Notebook targeting Kilo's declared zone", () => {
		expect(PLUGIN_ZONE_CONTRIBUTIONS).toContainEqual(
			expect.objectContaining({
				pluginId: "notebook",
				id: "notebook",
				zone: "kilo-ui/chat-right-panel-tab",
				label: "Notebook",
				mountPolicy: "keep-alive",
				requiresSignIn: true,
				signInHint: "Sign in to Kilo to use embedded notebooks.",
			}),
		);
	});

	it("includes Files' contributed right-panel icon renderer", () => {
		const contribution = PLUGIN_ZONE_CONTRIBUTIONS.find(
			(c) => c.pluginId === "files" && c.zone === "kilo-ui/chat-right-panel-tab",
		);
		expect(contribution).toMatchObject({
			pluginId: "files",
			id: "files",
			label: "Files",
		});
		expect(contribution?.icon).toBeTypeOf("function");
	});
});
