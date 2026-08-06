import type { BundledPlugin } from "@anaconda-agentic-desktop/feature-sdk";
import { app } from "electron";

/**
 * Bundled workspace plugins — main-process side (Decision #17).
 *
 * BUNDLED_PLUGINS is the single registration point for plugins. It FEEDS the
 * existing FEATURES / WEB_FEATURES boot paths rather than replacing them:
 * a plugin manifest carries both `main` and `web` entry points, but the two
 * boot paths live in different processes (Electron main vs renderer), so each
 * side keeps its own registry file importing only the entry it can run —
 * importing a Node-based main entry from the renderer bundle (or React from
 * the main process) would break the build. The loader
 * (`discoverPlugins(BUNDLED_PLUGINS, "main" | "web")`) turns both registries
 * into ordinary FeatureRegistrations, so plugins and features boot
 * identically.
 *
 * Adding a plugin:
 * 1. Create `plugins/<id>/` with a `plugin.json` (the `plugins/*` workspace
 *    glob is already in pnpm-workspace.yaml).
 * 2. Add the workspace dep to apps/desktop/package.json (and apps/web if the
 *    plugin ships UI).
 * 3. Register it here (and in apps/web/src/features/bundled-plugins.ts when
 *    it has a `web` entry). `resolveAsset` lets `mainSdk.resolvePluginAsset`
 *    locate files shipped inside the plugin package (drizzle migrations,
 *    seed data, ...).
 */

import kiloCodeManifest from "@anaconda-agentic-desktop/plugin-kilo-code/plugin.json" with { type: "json" };
import * as kiloCodeMain from "@anaconda-agentic-desktop/plugin-kilo-code/main";
import { createKiloCodeResolveAsset } from "@anaconda-agentic-desktop/plugin-kilo-code/packaged-assets";
import todosManifest from "@anaconda-agentic-desktop/plugin-todos/plugin.json" with { type: "json" };
import * as todosMain from "@anaconda-agentic-desktop/plugin-todos/main";
import workspacesManifest from "@anaconda-agentic-desktop/plugin-workspaces/plugin.json" with { type: "json" };
import * as workspacesMain from "@anaconda-agentic-desktop/plugin-workspaces/main";

import { bundledPluginAssetResolver } from "./bundled-plugin-assets.js";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{
		manifest: workspacesManifest,
		module: workspacesMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-workspaces"),
	},
	{
		manifest: kiloCodeManifest,
		module: kiloCodeMain,
		resolveAsset: createKiloCodeResolveAsset({
			isPackaged: app.isPackaged,
			packagedResourcesPath: process.resourcesPath,
		}),
	},
	{
		manifest: todosManifest,
		module: todosMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-todos"),
	},
];
