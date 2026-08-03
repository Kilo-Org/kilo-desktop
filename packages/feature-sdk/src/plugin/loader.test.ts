import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineMethod } from "../channel-map.js";
import { FeatureRouter } from "../services/feature-router.js";
import {
	discoverPlugins,
	pluginNav,
	pluginRegistrations,
	pluginRoutes,
	pluginZoneContributions,
	reportPluginDiscoveryIssues,
	type BundledPlugin,
} from "./loader.js";

import type { MainSdk } from "../types/sdk.js";

const pingChannels = {
	ping: defineMethod(z.undefined(), z.object({ pong: z.literal(true) })),
} as const;

function mainRegister(mainSdk: MainSdk): void {
	mainSdk.channels(pingChannels).handleAll({ ping: () => ({ pong: true as const }) });
}

function browserRegister(mainSdk: MainSdk): void {
	mainRegister(mainSdk);
}

const manifest = {
	id: "ping",
	displayName: "Ping",
	version: "1.0.0",
	main: "./src/main/index.ts",
	web: "./src/web/index.ts",
};

describe("discoverPlugins", () => {
	it("discovers a valid plugin for the main entry", () => {
		const bundled: BundledPlugin[] = [{ manifest, module: { mainRegister } }];
		const discovery = discoverPlugins(bundled, "main");

		expect(discovery.issues).toEqual([]);
		expect(discovery.plugins).toHaveLength(1);
		expect(discovery.plugins[0]?.manifest.id).toBe("ping");
		expect(discovery.plugins[0]?.registration).toEqual({ id: "ping", mainRegister });
	});

	it("activates a discovered plugin through the existing boot path", async () => {
		const bundled: BundledPlugin[] = [{ manifest, module: { mainRegister } }];
		const discovery = discoverPlugins(bundled, "main");
		const router = new FeatureRouter();

		// Activation phase: identical to bootFeatures / createFeatureSystem.
		for (const registration of pluginRegistrations(discovery)) {
			registration.mainRegister(router.createMainSdk(registration.id));
		}

		await expect(router.invoke("ping", "ping", undefined)).resolves.toEqual({ pong: true });
	});

	it("skips a plugin with an invalid manifest and reports an issue", () => {
		const bundled: BundledPlugin[] = [
			{ manifest: { id: "broken" }, module: { mainRegister } },
			{ manifest, module: { mainRegister } },
		];
		const discovery = discoverPlugins(bundled, "main");

		expect(discovery.plugins.map((p) => p.manifest.id)).toEqual(["ping"]);
		expect(discovery.issues).toHaveLength(1);
		expect(discovery.issues[0]?.message).toContain("index 0");
		expect(discovery.issues[0]?.message).toContain("plugin.json");
	});

	it("skips duplicate plugin ids and reports an issue", () => {
		const bundled: BundledPlugin[] = [
			{ manifest, module: { mainRegister } },
			{ manifest, module: { mainRegister } },
		];
		const discovery = discoverPlugins(bundled, "main");

		expect(discovery.plugins).toHaveLength(1);
		expect(discovery.issues).toEqual([
			{ pluginId: "ping", message: expect.stringContaining("Duplicate plugin id") },
		]);
	});

	it("reports an issue when the main entry module lacks mainRegister", () => {
		const bundled: BundledPlugin[] = [{ manifest, module: {} }];
		const discovery = discoverPlugins(bundled, "main");

		expect(discovery.plugins).toEqual([]);
		expect(discovery.issues).toEqual([
			{
				pluginId: "ping",
				message: expect.stringContaining("does not export mainRegister"),
			},
		]);
	});

	it("silently omits nothing — each registry lists only its own entries", () => {
		const webOnly = {
			id: "web-only",
			displayName: "Web Only",
			version: "1.0.0",
			web: "./src/web/index.ts",
		};
		const mainOnly = {
			id: "main-only",
			displayName: "Main Only",
			version: "1.0.0",
			main: "./src/main/index.ts",
		};

		const mainSide = discoverPlugins([{ manifest: mainOnly, module: { mainRegister } }], "main");
		expect(mainSide.plugins.map((p) => p.manifest.id)).toEqual(["main-only"]);
		expect(mainSide.issues).toEqual([]);

		const webSide = discoverPlugins([{ manifest: webOnly, module: { browserRegister } }], "web");
		expect(webSide.plugins.map((p) => p.manifest.id)).toEqual(["web-only"]);
		expect(webSide.issues).toEqual([]);
	});

	it("reports an issue when a registered plugin's manifest lacks the current entry", () => {
		const webOnly = {
			id: "web-only",
			displayName: "Web Only",
			version: "1.0.0",
			web: "./src/web/index.ts",
		};

		// Registration mistake: a web-only plugin added to the main registry.
		const discovery = discoverPlugins([{ manifest: webOnly, module: {} }], "main");

		expect(discovery.plugins).toEqual([]);
		expect(discovery.issues).toEqual([
			{
				pluginId: "web-only",
				message: expect.stringContaining('declares no "main" entry'),
			},
		]);
	});

	it("skips plugins whose id collides with a reserved built-in feature id", () => {
		const bundled: BundledPlugin[] = [{ manifest, module: { mainRegister } }];
		const discovery = discoverPlugins(bundled, "main", { reservedIds: ["ping", "other"] });

		expect(discovery.plugins).toEqual([]);
		expect(discovery.issues).toEqual([
			{
				pluginId: "ping",
				message: expect.stringContaining("collides with a built-in feature id"),
			},
		]);
	});

	it("wires browserRegister into the web-entry registration", () => {
		const bundled: BundledPlugin[] = [{ manifest, module: { browserRegister } }];
		const discovery = discoverPlugins(bundled, "web");

		const registration = discovery.plugins[0]?.registration;
		expect(registration?.browserRegister).toBe(browserRegister);

		// The placeholder mainRegister is inert — web boot paths never call it.
		expect(() => registration?.mainRegister(undefined as unknown as MainSdk)).not.toThrow();
	});

	it("threads BundledPlugin.resolveAsset onto the produced registration (main entry)", () => {
		const resolveAsset = vi.fn((subpath: string) => `/plugins/ping/${subpath}`);
		const bundled: BundledPlugin[] = [{ manifest, module: { mainRegister }, resolveAsset }];
		const discovery = discoverPlugins(bundled, "main");

		expect(discovery.plugins[0]?.registration.resolveAsset).toBe(resolveAsset);
	});

	it("threads BundledPlugin.resolveAsset onto the produced registration (web entry)", () => {
		const resolveAsset = vi.fn((subpath: string) => `/plugins/ping/${subpath}`);
		const bundled: BundledPlugin[] = [{ manifest, module: { browserRegister }, resolveAsset }];
		const discovery = discoverPlugins(bundled, "web");

		expect(discovery.plugins[0]?.registration.resolveAsset).toBe(resolveAsset);
	});

	it("leaves resolveAsset undefined when BundledPlugin does not provide one", () => {
		const bundled: BundledPlugin[] = [{ manifest, module: { mainRegister } }];
		const discovery = discoverPlugins(bundled, "main");
		expect(discovery.plugins[0]?.registration.resolveAsset).toBeUndefined();
	});

	it("omits browserRegister for Electron-only plugins so browser mode skips them", () => {
		const bundled: BundledPlugin[] = [{ manifest, module: {} }];
		const discovery = discoverPlugins(bundled, "web");

		expect(discovery.issues).toEqual([]);
		expect(discovery.plugins[0]?.registration.browserRegister).toBeUndefined();
	});

	it("reports non-Error manifest parse issues as strings", () => {
		// zod always throws ZodError, but the message formatter must not assume it.
		const bundled: BundledPlugin[] = [{ manifest: "not-an-object", module: {} }];
		const discovery = discoverPlugins(bundled, "main");
		expect(discovery.issues).toHaveLength(1);
	});
});

describe("pluginRegistrations", () => {
	it("returns an empty array for an empty registry", () => {
		expect(pluginRegistrations(discoverPlugins([], "main"))).toEqual([]);
	});
});

describe("contribution resolution", () => {
	const PingPage = () => null;
	const PingStatus = () => null;
	const routedManifest = {
		...manifest,
		contributes: {
			routes: [{ path: "/ping", component: "PingPage", title: "Ping" }],
			nav: [{ to: "/ping", label: "Ping", icon: "activity", priority: 5 }],
			zones: [{ zone: "status-bar", component: "PingStatus", priority: 3 }],
		},
	};

	it("resolves routes against the web entry module's exports (paths prefixed with /plugins)", () => {
		const bundled: BundledPlugin[] = [
			{ manifest: routedManifest, module: { browserRegister, PingPage, PingStatus } },
		];
		const discovery = discoverPlugins(bundled, "web");

		expect(discovery.issues).toEqual([]);
		expect(pluginRoutes(discovery)).toEqual([
			{
				pluginId: "ping",
				path: "/plugins/ping",
				title: "Ping",
				component: PingPage,
				browserSafe: true,
			},
		]);
	});

	it("resolves nav entries as pure data with paths prefixed under /plugins", () => {
		const bundled: BundledPlugin[] = [
			{ manifest: routedManifest, module: { browserRegister, PingPage, PingStatus } },
		];
		const discovery = discoverPlugins(bundled, "web");

		expect(pluginNav(discovery)).toEqual([
			{ pluginId: "ping", to: "/plugins/ping", label: "Ping", icon: "activity", priority: 5 },
		]);
	});

	it("resolves zone widgets against the module and defaults label to the component name", () => {
		const bundled: BundledPlugin[] = [
			{ manifest: routedManifest, module: { browserRegister, PingPage, PingStatus } },
		];
		const discovery = discoverPlugins(bundled, "web");

		expect(pluginZoneContributions(discovery)).toEqual([
			{
				pluginId: "ping",
				zone: "status-bar",
				label: "PingStatus",
				component: PingStatus,
				priority: 3,
				browserSafe: true,
			},
		]);
	});

	it("marks routes and zones of Electron-only plugins as not browser-safe", () => {
		const bundled: BundledPlugin[] = [
			{ manifest: routedManifest, module: { PingPage, PingStatus } },
		];
		const discovery = discoverPlugins(bundled, "web");

		expect(discovery.issues).toEqual([]);
		expect(pluginRoutes(discovery)[0]?.browserSafe).toBe(false);
		expect(pluginZoneContributions(discovery)[0]?.browserSafe).toBe(false);
	});

	it("treats renderer-only plugins (no main entry) as browser-safe", () => {
		const webOnly = {
			id: "web-only",
			displayName: "Web Only",
			version: "1.0.0",
			web: "./src/web/index.ts",
			contributes: { routes: [{ path: "/web-only", component: "PingPage" }] },
		};
		const discovery = discoverPlugins([{ manifest: webOnly, module: { PingPage } }], "web");

		expect(discovery.issues).toEqual([]);
		expect(pluginRoutes(discovery)[0]?.browserSafe).toBe(true);
		expect(pluginRoutes(discovery)[0]?.path).toBe("/plugins/web-only");
	});

	it("skips a route whose component export is missing and keeps the plugin", () => {
		const bundled: BundledPlugin[] = [
			{ manifest: routedManifest, module: { browserRegister, PingStatus } }, // no PingPage
		];
		const discovery = discoverPlugins(bundled, "web");

		expect(discovery.plugins).toHaveLength(1);
		expect(pluginRoutes(discovery)).toEqual([]);
		expect(discovery.issues).toEqual([
			{
				pluginId: "ping",
				message: expect.stringContaining('names component export "PingPage"'),
			},
		]);
	});

	it("skips a zone widget whose component export is missing", () => {
		const bundled: BundledPlugin[] = [
			{ manifest: routedManifest, module: { browserRegister, PingPage } }, // no PingStatus
		];
		const discovery = discoverPlugins(bundled, "web");

		expect(pluginZoneContributions(discovery)).toEqual([]);
		expect(discovery.issues).toEqual([
			{
				pluginId: "ping",
				message: expect.stringContaining('names component export "PingStatus"'),
			},
		]);
	});

	it("skips a zone widget targeting a non-canonical zone", () => {
		const badZone = {
			...manifest,
			contributes: { zones: [{ zone: "statusbar", component: "PingStatus" }] },
		};
		const discovery = discoverPlugins(
			[{ manifest: badZone, module: { browserRegister, PingStatus } }],
			"web",
		);

		expect(pluginZoneContributions(discovery)).toEqual([]);
		expect(discovery.issues).toEqual([
			{
				pluginId: "ping",
				message: expect.stringContaining('unknown zone "statusbar"'),
			},
		]);
	});

	it("skips a route path already claimed by an earlier plugin", () => {
		const OtherPage = () => null;
		const rival = {
			id: "rival",
			displayName: "Rival",
			version: "1.0.0",
			web: "./src/web/index.ts",
			contributes: { routes: [{ path: "/ping", component: "OtherPage" }] },
		};
		const bundled: BundledPlugin[] = [
			{ manifest: routedManifest, module: { browserRegister, PingPage, PingStatus } },
			{ manifest: rival, module: { OtherPage } },
		];
		const discovery = discoverPlugins(bundled, "web");

		expect(pluginRoutes(discovery).map((route) => route.pluginId)).toEqual(["ping"]);
		expect(discovery.issues).toEqual([
			{
				pluginId: "rival",
				message: expect.stringContaining('already claimed by plugin "ping"'),
			},
		]);
	});

	it("does not resolve contributions for main-entry discovery (renderer concern)", () => {
		const bundled: BundledPlugin[] = [
			{ manifest: routedManifest, module: { mainRegister, PingPage, PingStatus } },
		];
		const discovery = discoverPlugins(bundled, "main");

		expect(discovery.issues).toEqual([]);
		expect(pluginRoutes(discovery)).toEqual([]);
		expect(pluginNav(discovery)).toEqual([]);
		expect(pluginZoneContributions(discovery)).toEqual([]);
	});
});

describe("reportPluginDiscoveryIssues", () => {
	it("logs each issue with the [PluginLoader] prefix", () => {
		const discovery = discoverPlugins([{ manifest: { id: "broken" }, module: {} }], "main");
		const logged: string[] = [];

		reportPluginDiscoveryIssues(discovery, (message) => logged.push(message));

		expect(logged).toHaveLength(1);
		expect(logged[0]).toMatch(/^\[PluginLoader\] /);
	});

	it("defaults to console.error", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			reportPluginDiscoveryIssues(discoverPlugins([{ manifest: {}, module: {} }], "main"));
			expect(spy).toHaveBeenCalledOnce();
			expect(spy.mock.calls[0]?.[0]).toContain("[PluginLoader]");
		} finally {
			spy.mockRestore();
		}
	});

	it("logs nothing for a clean discovery", () => {
		const logged: string[] = [];
		reportPluginDiscoveryIssues(discoverPlugins([], "main"), (message) => logged.push(message));
		expect(logged).toEqual([]);
	});
});
