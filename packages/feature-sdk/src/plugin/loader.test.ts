import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineMethod } from "../channel-map.js";
import { FeatureRouter } from "../services/feature-router.js";
import {
	discoverPlugins,
	pluginRegistrations,
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
