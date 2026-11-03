import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BUNDLED_PLUGINS } from "@kilo-desktop/bundled-plugins";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json";

import { bundledPluginRoot, bundledWebPluginIds, mainRegistrations } from "./plugins.js";

const idOf = (manifest: unknown) => (manifest as { id: string }).id;
const bundledIds = BUNDLED_PLUGINS.map((plugin) => idOf(plugin.manifest));

describe("bundled plugin wiring", () => {
	it("registers every bundled plugin with the main kernel", () => {
		const registeredIds = mainRegistrations().map((registration) => idOf(registration.manifest));

		expect(registeredIds.toSorted()).toEqual(bundledIds.toSorted());
	});

	it("lists only bundled plugins as web plugins", () => {
		const webIds = bundledWebPluginIds();

		expect(webIds.length).toBeGreaterThan(0);
		expect(webIds.every((id) => bundledIds.includes(id))).toBe(true);
	});

	it("resolves the package folder of a plugin that ships resources", () => {
		const root = bundledPluginRoot(terminalManifest.id);

		expect(root).toBeDefined();
		const manifest = JSON.parse(readFileSync(path.join(root!, "plugin.json"), "utf8"));
		expect(manifest.id).toBe(terminalManifest.id);
	});

	it("has no package folder for plugins without resources", () => {
		expect(bundledPluginRoot("acme.unknown")).toBeUndefined();
	});
});
