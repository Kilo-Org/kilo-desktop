import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BUNDLED_PLUGINS } from "@kilo-desktop/bundled-plugins";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import environmentsManifest from "@kilo-desktop/plugin-environments/plugin.json";
import filesManifest from "@kilo-desktop/plugin-files/plugin.json";
import gitManifest from "@kilo-desktop/plugin-git/plugin.json";
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";

import { bundledPluginRoot, bundledWebPluginIds, mainRegistrations } from "./plugins.js";

const idOf = (manifest: unknown) => (manifest as { id: string }).id;
const bundledIds = BUNDLED_PLUGINS.map((plugin) => idOf(plugin.manifest));

describe("bundled plugin wiring", () => {
	it("registers every bundled plugin with the main kernel", () => {
		const registeredIds = mainRegistrations().map((registration) => idOf(registration.manifest));

		expect(registeredIds.toSorted()).toEqual(bundledIds.toSorted());
	});

	it("lists only bundled plugins with a window entry as web plugins", () => {
		const webIds = bundledWebPluginIds();

		expect(webIds.every((id) => bundledIds.includes(id))).toBe(true);
		// kilo.core has no web entry, so a window may never call main as it.
		expect(webIds).not.toContain(coreManifest.id);
	});

	it("resolves the package folder of a plugin that ships resources", () => {
		const root = bundledPluginRoot(coreManifest.id);

		expect(root).toBeDefined();
		const manifest = JSON.parse(readFileSync(path.join(root!, "plugin.json"), "utf8"));
		expect(manifest.id).toBe(coreManifest.id);
	});

	it("resolves kilo.terminal's package folder, where its frame is built into resources/", () => {
		const root = bundledPluginRoot(terminalManifest.id);

		expect(root).toBeDefined();
		const manifest = JSON.parse(readFileSync(path.join(root!, "plugin.json"), "utf8"));
		expect(manifest.id).toBe(terminalManifest.id);
	});

	it("resolves kilo.notebook's package folder, where its runtimed, UI and Kilo plugin are staged into resources/", () => {
		const root = bundledPluginRoot(notebookManifest.id);

		expect(root).toBeDefined();
		const manifest = JSON.parse(readFileSync(path.join(root!, "plugin.json"), "utf8"));
		expect(manifest.id).toBe(notebookManifest.id);
	});

	it("resolves kilo.environments' package folder, where its conda bridge is staged into resources/", () => {
		const root = bundledPluginRoot(environmentsManifest.id);

		expect(root).toBeDefined();
		const manifest = JSON.parse(readFileSync(path.join(root!, "plugin.json"), "utf8"));
		expect(manifest.id).toBe(environmentsManifest.id);
	});

	it("has no package folder for plugins without resources", () => {
		expect(bundledPluginRoot(shellManifest.id)).toBeUndefined();
		expect(bundledPluginRoot(workSessionsManifest.id)).toBeUndefined();
		expect(bundledPluginRoot(chatManifest.id)).toBeUndefined();
		expect(bundledPluginRoot(gitManifest.id)).toBeUndefined();
		expect(bundledPluginRoot(filesManifest.id)).toBeUndefined();
		expect(bundledPluginRoot("acme.unknown")).toBeUndefined();
	});
});
