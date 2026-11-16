import { createRequire } from "node:module";
import path from "node:path";

import { BUNDLED_PLUGINS, webPluginIds, withEntries } from "@kilo-desktop/bundled-plugins";
import type { PluginEntry, PluginRegistration } from "@kilo-desktop/kernel";
import anacondaManifest from "@kilo-desktop/plugin-anaconda/plugin.json";
import { anacondaMainEntry } from "@kilo-desktop/plugin-anaconda/main";
import browserManifest from "@kilo-desktop/plugin-browser/plugin.json";
import { browserMainEntry } from "@kilo-desktop/plugin-browser/main";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { chatMainEntry } from "@kilo-desktop/plugin-chat/main";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { coreMainEntry } from "@kilo-desktop/plugin-core/main";
import filesManifest from "@kilo-desktop/plugin-files/plugin.json";
import { filesMainEntry } from "@kilo-desktop/plugin-files/main";
import environmentsManifest from "@kilo-desktop/plugin-environments/plugin.json";
import { environmentsMainEntry } from "@kilo-desktop/plugin-environments/main";
import gitManifest from "@kilo-desktop/plugin-git/plugin.json";
import { gitMainEntry } from "@kilo-desktop/plugin-git/main";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import { localInferenceMainEntry } from "@kilo-desktop/plugin-local-inference/main";
import marketplaceManifest from "@kilo-desktop/plugin-marketplace/plugin.json";
import { marketplaceMainEntry } from "@kilo-desktop/plugin-marketplace/main";
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json";
import { notebookMainEntry } from "@kilo-desktop/plugin-notebook/main";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { shellMainEntry } from "@kilo-desktop/plugin-shell/main";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json";
import { terminalMainEntry } from "@kilo-desktop/plugin-terminal/main";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { workSessionsMainEntry } from "@kilo-desktop/plugin-work-sessions/main";
import boardManifest from "@kilo-desktop/plugin-workspace-board/plugin.json";
import { boardMainEntry } from "@kilo-desktop/plugin-workspace-board/main";
import workbooksManifest from "@kilo-desktop/plugin-workbooks/plugin.json";
import { workbooksMainEntry } from "@kilo-desktop/plugin-workbooks/main";

/** Main-process entries of bundled plugins, by plugin id. Grows one plugin at a time. */
export const MAIN_ENTRIES: Readonly<Record<string, PluginEntry>> = {
	[coreManifest.id]: coreMainEntry,
	[shellManifest.id]: shellMainEntry,
	[workSessionsManifest.id]: workSessionsMainEntry,
	[chatManifest.id]: chatMainEntry,
	[gitManifest.id]: gitMainEntry,
	[filesManifest.id]: filesMainEntry,
	[terminalManifest.id]: terminalMainEntry,
	[browserManifest.id]: browserMainEntry,
	[notebookManifest.id]: notebookMainEntry,
	[marketplaceManifest.id]: marketplaceMainEntry,
	[localInferenceManifest.id]: localInferenceMainEntry,
	[environmentsManifest.id]: environmentsMainEntry,
	[anacondaManifest.id]: anacondaMainEntry,
	[boardManifest.id]: boardMainEntry,
	[workbooksManifest.id]: workbooksMainEntry,
};

/** Packages of bundled plugins that ship files in `resources/`, by plugin id. */
const ASSET_PACKAGES: Readonly<Record<string, string>> = {
	[coreManifest.id]: "@kilo-desktop/plugin-core",
	[terminalManifest.id]: "@kilo-desktop/plugin-terminal",
	[notebookManifest.id]: "@kilo-desktop/plugin-notebook",
	[environmentsManifest.id]: "@kilo-desktop/plugin-environments",
};

export function mainRegistrations(): PluginRegistration[] {
	return withEntries(MAIN_ENTRIES, BUNDLED_PLUGINS);
}

export function bundledWebPluginIds(): string[] {
	return webPluginIds(BUNDLED_PLUGINS);
}

/**
 * A bundled plugin's package folder in development, found through its
 * `plugin.json` export (pnpm links it to the workspace source, where
 * `prepare-assets` stages its resources).
 */
export function bundledPluginRoot(pluginId: string): string | undefined {
	const packageName = ASSET_PACKAGES[pluginId];
	if (!packageName) return undefined;
	const require = createRequire(import.meta.url);
	return path.dirname(require.resolve(`${packageName}/plugin.json`));
}
