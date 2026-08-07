import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createKiloServerResolveAsset } from "./resolve-plugin-asset.js";

describe("createKiloServerResolveAsset", () => {
	const require = createRequire(import.meta.url);
	const packageRoot = path.dirname(
		require.resolve("@anaconda-agentic-desktop/plugin-kilo-server/plugin.json"),
	);

	it("resolves packaged CLI assets from Electron resourcesPath", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/App/Contents/Resources",
		});

		expect(resolveAsset("resources/kilo")).toBe(path.join("/App/Contents/Resources", "kilo"));
	});

	it("packaged mode ignores devResourceRoot", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/App/Contents/Resources",
			devResourceRoot: "/workspace/plugins/kilo-server/resources/kilo",
		});

		expect(resolveAsset("resources/kilo")).toBe(path.join("/App/Contents/Resources", "kilo"));
	});

	it("resolves non-CLI assets from the plugin package when packaged", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/App/Contents/Resources",
		});

		expect(resolveAsset("plugin.json")).toBe(path.join(packageRoot, "plugin.json"));
	});

	it("resolves CLI assets from devResourceRoot when unpackaged (dev mode)", () => {
		const devResourceRoot = "/workspace/plugins/kilo-server/resources/kilo";
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
			devResourceRoot,
		});

		expect(resolveAsset("resources/kilo")).toBe(devResourceRoot);
	});

	it("falls back to package resolution for CLI when devResourceRoot is absent", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});

		expect(resolveAsset("resources/kilo")).toBe(path.join(packageRoot, "resources/kilo"));
	});

	it("resolves non-CLI assets from the plugin package when unpackaged", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
			devResourceRoot: "/workspace/plugins/kilo-server/resources/kilo",
		});

		expect(resolveAsset("plugin.json")).toBe(path.join(packageRoot, "plugin.json"));
	});
});
