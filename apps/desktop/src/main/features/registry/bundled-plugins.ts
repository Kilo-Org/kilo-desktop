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

import kiloServerManifest from "@anaconda-agentic-desktop/plugin-kilo-server/plugin.json" with { type: "json" };
import * as kiloServerMain from "@anaconda-agentic-desktop/plugin-kilo-server/main";
import { createKiloServerResolveAsset } from "@anaconda-agentic-desktop/plugin-kilo-server/packaged-assets";
import kiloUiManifest from "@anaconda-agentic-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import * as kiloUiMain from "@anaconda-agentic-desktop/plugin-kilo-ui/main";
import todosManifest from "@anaconda-agentic-desktop/plugin-todos/plugin.json" with { type: "json" };
import * as todosMain from "@anaconda-agentic-desktop/plugin-todos/main";

import { bundledPluginAssetResolver } from "./bundled-plugin-assets.js";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{
		manifest: kiloUiManifest,
		module: kiloUiMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-kilo-ui"),
	},
	{
		manifest: kiloServerManifest,
		module: kiloServerMain,
		resolveAsset: createKiloServerResolveAsset({
			isPackaged: app.isPackaged,
			packagedResourcesPath: process.resourcesPath,
			// Vite inlines this at bundle time (see vite.main.config.ts). In
			// dev, pnpm's injected node_modules copies of the plugin don't
			// include the fetched CLI, so we resolve the workspace source
			// directly. Ignored when app.isPackaged is true.
			devResourceRoot: __KILO_SERVER_DEV_RESOURCE_ROOT__,
		}),
	},
	{
		manifest: todosManifest,
		module: todosMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-todos"),
	},
];
