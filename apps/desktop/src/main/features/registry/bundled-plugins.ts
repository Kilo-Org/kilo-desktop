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

import environmentsManifest from "@anaconda-agentic-desktop/plugin-environments/plugin.json" with { type: "json" };
import * as environmentsMain from "@anaconda-agentic-desktop/plugin-environments/main";
import filesManifest from "@anaconda-agentic-desktop/plugin-files/plugin.json" with { type: "json" };
import * as filesMain from "@anaconda-agentic-desktop/plugin-files/main";
import gitManifest from "@anaconda-agentic-desktop/plugin-git/plugin.json" with { type: "json" };
import * as gitMain from "@anaconda-agentic-desktop/plugin-git/main";
import kiloServerManifest from "@anaconda-agentic-desktop/plugin-kilo-server/plugin.json" with { type: "json" };
import * as kiloServerMain from "@anaconda-agentic-desktop/plugin-kilo-server/main";
import { createKiloServerResolveAsset } from "@anaconda-agentic-desktop/plugin-kilo-server/packaged-assets";
import kiloUiManifest from "@anaconda-agentic-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import * as kiloUiMain from "@anaconda-agentic-desktop/plugin-kilo-ui/main";
import localInferenceManifest from "@anaconda-agentic-desktop/plugin-local-inference/plugin.json" with { type: "json" };
import * as localInferenceMain from "@anaconda-agentic-desktop/plugin-local-inference/main";
import notebookManifest from "@anaconda-agentic-desktop/plugin-notebook/plugin.json" with { type: "json" };
import * as notebookMain from "@anaconda-agentic-desktop/plugin-notebook/main";
import { createNotebookResolveAsset } from "@anaconda-agentic-desktop/plugin-notebook/packaged-assets";
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
		}),
	},
	{
		manifest: notebookManifest,
		module: notebookMain,
		resolveAsset: createNotebookResolveAsset({
			isPackaged: app.isPackaged,
			packagedResourcesPath: process.resourcesPath,
		}),
	},
	{
		manifest: filesManifest,
		module: filesMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-files"),
	},
	{
		manifest: todosManifest,
		module: todosMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-todos"),
	},
	{
		manifest: environmentsManifest,
		module: environmentsMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-environments"),
	},
	{
		manifest: localInferenceManifest,
		module: localInferenceMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-local-inference"),
	},
	{
		manifest: gitManifest,
		module: gitMain,
		resolveAsset: bundledPluginAssetResolver("@anaconda-agentic-desktop/plugin-git"),
	},
];
