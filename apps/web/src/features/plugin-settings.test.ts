import { describe, expect, it } from "vitest";

import { discoverPlugins, type PluginDiscovery } from "@kilo-desktop/feature-sdk";

import { PLUGIN_SETTINGS } from "./plugin-settings-entries";
import {
	buildPluginSettings,
	filterVisiblePluginSettings,
	findSettingsSection,
	isSettingsPath,
	type PluginSettingsSection,
} from "./plugin-settings";

const AlphaPanel = () => null;
const BetaPanel = () => null;
const AlphaIcon = () => null;

function makeDiscovery(): PluginDiscovery {
	return discoverPlugins(
		[
			{
				manifest: {
					id: "alpha",
					displayName: "Alpha",
					version: "1.0.0",
					web: "./src/web/index.ts",
					contributes: {
						settings: [
							{
								id: "alpha",
								title: "Alpha",
								component: "AlphaPanel",
								icon: "AlphaIcon",
								priority: 1,
							},
							{
								id: "beta",
								title: "Beta",
								component: "BetaPanel",
								category: "Advanced",
								priority: 10,
								featureFlag: "beta-settings",
							},
						],
					},
				},
				module: { AlphaPanel, BetaPanel, AlphaIcon },
			},
		],
		"web",
	);
}

describe("buildPluginSettings", () => {
	it("registers Privacy as an ungated desktop settings section", () => {
		expect(findSettingsSection(PLUGIN_SETTINGS, "privacy")).toMatchObject({
			pluginId: "privacy",
			title: "Privacy",
			browserSafe: false,
			featureFlag: undefined,
		});
	});
	it("derives priority-ordered sections from discovery", () => {
		const sections = buildPluginSettings(makeDiscovery());

		expect(sections.map((section) => section.id)).toEqual(["beta", "alpha"]);
		expect(sections[1]).toEqual({
			pluginId: "alpha",
			id: "alpha",
			title: "Alpha",
			component: AlphaPanel,
			category: "General",
			icon: "AlphaIcon",
			iconComponent: AlphaIcon,
			priority: 1,
			featureFlag: undefined,
			browserSafe: true,
		});
		expect(sections[0]?.category).toBe("Advanced");
		expect(sections[0]?.featureFlag).toBe("beta-settings");
	});

	it("merges built-in sections ahead of plugin contributions, then sorts by priority", () => {
		const builtIn: PluginSettingsSection[] = [
			{
				pluginId: "shell",
				id: "general",
				title: "General",
				component: () => null,
				category: "General",
				icon: undefined,
				iconComponent: undefined,
				priority: 5,
				featureFlag: undefined,
				browserSafe: true,
			},
		];
		const sections = buildPluginSettings(makeDiscovery(), { builtIn });
		expect(sections.map((section) => section.id)).toEqual(["beta", "general", "alpha"]);
	});
});

describe("filterVisiblePluginSettings", () => {
	const sections = buildPluginSettings(makeDiscovery());

	it("keeps sections without a featureFlag regardless of flag map", () => {
		expect(filterVisiblePluginSettings(sections, {}, true).map((s) => s.id)).toContain("alpha");
	});

	it("hides sections whose gating flag is missing or falsy", () => {
		expect(filterVisiblePluginSettings(sections, {}, true).map((s) => s.id)).not.toContain("beta");
		expect(
			filterVisiblePluginSettings(sections, { "beta-settings": false }, true).map((s) => s.id),
		).not.toContain("beta");
	});

	it("shows sections whose gating flag is truthy", () => {
		expect(
			filterVisiblePluginSettings(sections, { "beta-settings": true }, true).map((s) => s.id),
		).toContain("beta");
	});

	it("omits Electron-only sections when the desktop bridge is unavailable", () => {
		const electronOnly: PluginSettingsSection[] = [
			{
				pluginId: "desk",
				id: "desk",
				title: "Desk",
				component: () => null,
				category: "General",
				icon: undefined,
				iconComponent: undefined,
				priority: 0,
				featureFlag: undefined,
				browserSafe: false,
			},
		];
		expect(filterVisiblePluginSettings(electronOnly, {}, false)).toEqual([]);
		expect(filterVisiblePluginSettings(electronOnly, {}, true)).toHaveLength(1);
	});
});

describe("findSettingsSection", () => {
	it("finds a section by id", () => {
		const sections = buildPluginSettings(makeDiscovery());
		expect(findSettingsSection(sections, "alpha")?.title).toBe("Alpha");
		expect(findSettingsSection(sections, "missing")).toBeUndefined();
	});
});

describe("PLUGIN_SETTINGS", () => {
	it("lists General settings alphabetically", () => {
		const general = PLUGIN_SETTINGS.filter((section) => section.category === "General");
		expect(general.map((section) => section.title)).toEqual([
			"About",
			"Account",
			"Appearance",
			"Conda Environments",
			"Notebooks",
			"Privacy",
		]);
	});

	it("includes the kilo-ui AI Providers section", () => {
		expect(PLUGIN_SETTINGS.some((section) => section.id === "kilo-providers")).toBe(true);
		expect(PLUGIN_SETTINGS.find((section) => section.id === "kilo-providers")).toMatchObject({
			pluginId: "kilo-ui",
			title: "AI Providers",
			category: "AI",
			priority: 90,
		});
	});

	it("includes the kilo-ui Account section under General", () => {
		expect(PLUGIN_SETTINGS.find((section) => section.id === "account")).toMatchObject({
			pluginId: "kilo-ui",
			title: "Account",
			category: "General",
			priority: 105,
		});
	});

	it("includes Local Model Server under AI", () => {
		expect(PLUGIN_SETTINGS.find((section) => section.id === "local-model-server")).toMatchObject({
			pluginId: "local-inference",
			title: "Local Model Server",
			category: "AI",
			priority: 80,
		});
	});

	it("does not expose the local model catalog as a separate settings section", () => {
		expect(PLUGIN_SETTINGS.some((section) => section.id === "local-model-catalog")).toBe(false);
	});

	it("includes Agent Behavior under AI", () => {
		expect(PLUGIN_SETTINGS.find((section) => section.id === "kilo-marketplace")).toMatchObject({
			pluginId: "kilo-marketplace",
			title: "Agent Behavior",
			category: "AI",
			priority: 100,
		});
	});

	it("lists notebook settings directly below Conda Environments", () => {
		const general = PLUGIN_SETTINGS.filter((section) => section.category === "General").map(
			(section) => section.id,
		);
		expect(general.indexOf("notebooks")).toBe(general.indexOf("environments") + 1);
	});

	it("lists AI settings by priority", () => {
		const aiSections = PLUGIN_SETTINGS.filter((section) => section.category === "AI");
		expect(aiSections.map((section) => section.id)).toEqual([
			"kilo-marketplace",
			"kilo-providers",
			"local-model-server",
		]);
	});
});

describe("isSettingsPath", () => {
	it("matches the settings takeover routes", () => {
		expect(isSettingsPath("/settings")).toBe(true);
		expect(isSettingsPath("/settings/alpha")).toBe(true);
		expect(isSettingsPath("/plugins/chat")).toBe(false);
		expect(isSettingsPath("/")).toBe(false);
	});
});
