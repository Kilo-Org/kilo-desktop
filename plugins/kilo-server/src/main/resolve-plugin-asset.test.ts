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

	it("resolves non-CLI assets from the plugin package when packaged", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/App/Contents/Resources",
		});

		expect(resolveAsset("plugin.json")).toBe(path.join(packageRoot, "plugin.json"));
	});

	it("resolves all assets from the plugin package when unpackaged", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});

		expect(resolveAsset("resources/kilo")).toBe(path.join(packageRoot, "resources/kilo"));
	});
});
