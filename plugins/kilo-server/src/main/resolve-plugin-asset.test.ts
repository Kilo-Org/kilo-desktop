import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createKiloServerResolveAsset } from "./resolve-plugin-asset.js";

describe("createKiloServerResolveAsset", () => {
	const require = createRequire(import.meta.url);
	const packageRoot = realpathSync(
		path.dirname(require.resolve("@anaconda-agentic-desktop/plugin-kilo-server/plugin.json")),
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

	it("resolves CLI assets from workspace source when unpackaged (dev mode)", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});

		// In dev mode, require.resolve follows the workspace symlink to the
		// plugin source tree, and realpathSync guarantees the real path.
		expect(resolveAsset("resources/kilo")).toBe(path.join(packageRoot, "resources/kilo"));
	});

	it("resolves non-CLI assets from the plugin package when unpackaged", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});

		expect(resolveAsset("plugin.json")).toBe(path.join(packageRoot, "plugin.json"));
	});
});
