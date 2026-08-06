import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createKiloCodeResolveAsset } from "./resolve-plugin-asset.js";

describe("createKiloCodeResolveAsset", () => {
	const require = createRequire(import.meta.url);
	const packageRoot = path.dirname(
		require.resolve("@anaconda-agentic-desktop/plugin-kilo-code/plugin.json"),
	);

	it("resolves packaged CLI assets from Electron resourcesPath", () => {
		const resolveAsset = createKiloCodeResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/App/Contents/Resources",
		});

		expect(resolveAsset("resources/kilo")).toBe(path.join("/App/Contents/Resources", "kilo"));
	});

	it("resolves non-CLI assets from the plugin package when packaged", () => {
		const resolveAsset = createKiloCodeResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/App/Contents/Resources",
		});

		expect(resolveAsset("plugin.json")).toBe(path.join(packageRoot, "plugin.json"));
	});

	it("resolves all assets from the plugin package when unpackaged", () => {
		const resolveAsset = createKiloCodeResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});

		expect(resolveAsset("resources/kilo")).toBe(path.join(packageRoot, "resources/kilo"));
	});
});
