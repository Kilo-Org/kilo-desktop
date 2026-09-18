import type { BundledPlugin } from "@kilo-desktop/feature-sdk";
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

import * as environmentsMain from "@kilo-desktop/plugin-environments/main";
import * as browserMain from "@kilo-desktop/plugin-browser/main";
import * as filesMain from "@kilo-desktop/plugin-files/main";
import * as gitMain from "@kilo-desktop/plugin-git/main";
import * as kiloServerMain from "@kilo-desktop/plugin-kilo-server/main";
import { createKiloServerResolveAsset } from "@kilo-desktop/plugin-kilo-server/packaged-assets";
import * as kiloUiMain from "@kilo-desktop/plugin-kilo-ui/main";
import * as localInferenceMain from "@kilo-desktop/plugin-local-inference/main";
import * as notebookMain from "@kilo-desktop/plugin-notebook/main";
import { createNotebookResolveAsset } from "@kilo-desktop/plugin-notebook/packaged-assets";
import * as terminalMain from "@kilo-desktop/plugin-terminal/main";
import * as todosMain from "@kilo-desktop/plugin-todos/main";

import { bundledPluginAssetResolver } from "./bundled-plugin-assets.js";
import { bundledPluginManifests } from "./bundled-plugin-manifests.js";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{
		manifest: bundledPluginManifests.browser,
		module: browserMain,
		resolveAsset: bundledPluginAssetResolver("@kilo-desktop/plugin-browser"),
	},
	{
		manifest: bundledPluginManifests.kiloUi,
		module: kiloUiMain,
		resolveAsset: bundledPluginAssetResolver("@kilo-desktop/plugin-kilo-ui"),
	},
	{
		manifest: bundledPluginManifests.kiloServer,
		module: kiloServerMain,
		resolveAsset: createKiloServerResolveAsset({
			isPackaged: app.isPackaged,
			packagedResourcesPath: process.resourcesPath,
		}),
	},
	{
		manifest: bundledPluginManifests.notebook,
		module: notebookMain,
		resolveAsset: createNotebookResolveAsset({
			isPackaged: app.isPackaged,
			packagedResourcesPath: process.resourcesPath,
		}),
	},
	{
		manifest: bundledPluginManifests.files,
		module: filesMain,
		resolveAsset: bundledPluginAssetResolver("@kilo-desktop/plugin-files"),
	},
	{
		manifest: bundledPluginManifests.terminal,
		module: terminalMain,
		resolveAsset: bundledPluginAssetResolver("@kilo-desktop/plugin-terminal"),
	},
	{
		manifest: bundledPluginManifests.todos,
		module: todosMain,
		resolveAsset: bundledPluginAssetResolver("@kilo-desktop/plugin-todos"),
	},
	{
		manifest: bundledPluginManifests.environments,
		module: environmentsMain,
		resolveAsset: bundledPluginAssetResolver("@kilo-desktop/plugin-environments"),
	},
	{
		manifest: bundledPluginManifests.localInference,
		module: localInferenceMain,
		resolveAsset: bundledPluginAssetResolver("@kilo-desktop/plugin-local-inference"),
	},
	{
		manifest: bundledPluginManifests.git,
		module: gitMain,
		resolveAsset: bundledPluginAssetResolver("@kilo-desktop/plugin-git"),
	},
];
