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

	it("resolves the packaged WebMCP relay from a short extra-resource path", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/App/Contents/Resources",
		});

		expect(resolveAsset("relay-runtime")).toBe(
			path.join("/App/Contents/Resources", "webmcp-relay"),
		);
	});

	it("resolves non-CLI assets from the plugin package when packaged", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/App/Contents/Resources",
		});

		expect(resolveAsset("plugin.json")).toBe(path.join(packageRoot, "plugin.json"));
	});

	it("resolves CLI assets via the linked plugin package when unpackaged", () => {
		// With apps/* depending on plugin-kilo-server via `link:` protocol,
		// require.resolve returns the workspace source path, where fetch-cli
		// stages the CLI binary.
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});

		expect(resolveAsset("resources/kilo")).toBe(path.join(packageRoot, "resources/kilo"));
	});

	it("resolves the WebMCP relay from the plugin package when unpackaged", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});

		expect(resolveAsset("relay-runtime")).toBe(path.join(packageRoot, "relay-runtime"));
	});

	it("resolves non-CLI assets from the plugin package when unpackaged", () => {
		const resolveAsset = createKiloServerResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});

		expect(resolveAsset("plugin.json")).toBe(path.join(packageRoot, "plugin.json"));
	});
});
