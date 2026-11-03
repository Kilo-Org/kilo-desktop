import { createRequire } from "node:module";
import path from "node:path";

import { BUNDLED_PLUGINS, webPluginIds, withEntries } from "@kilo-desktop/bundled-plugins";
import type { PluginEntry, PluginRegistration } from "@kilo-desktop/kernel";
import accountManifest from "@kilo-desktop/plugin-account/plugin.json";
import { accountMainEntry } from "@kilo-desktop/plugin-account/main";
import anacondaAccountManifest from "@kilo-desktop/plugin-anaconda-account/plugin.json";
import { anacondaAccountMainEntry } from "@kilo-desktop/plugin-anaconda-account/main";
import agentManifest from "@kilo-desktop/plugin-agent/plugin.json";
import { agentMainEntry } from "@kilo-desktop/plugin-agent/main";
import boardManifest from "@kilo-desktop/plugin-workspace-board/plugin.json";
import { boardMainEntry } from "@kilo-desktop/plugin-workspace-board/main";
import browserManifest from "@kilo-desktop/plugin-browser/plugin.json";
import { browserMainEntry } from "@kilo-desktop/plugin-browser/main";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { chatMainEntry } from "@kilo-desktop/plugin-chat/main";
import environmentsManifest from "@kilo-desktop/plugin-environments/plugin.json";
import { environmentsMainEntry } from "@kilo-desktop/plugin-environments/main";
import filesManifest from "@kilo-desktop/plugin-files/plugin.json";
import { filesMainEntry } from "@kilo-desktop/plugin-files/main";
import flagsManifest from "@kilo-desktop/plugin-flags/plugin.json";
import { flagsMainEntry } from "@kilo-desktop/plugin-flags/main";
import gitManifest from "@kilo-desktop/plugin-git/plugin.json";
import { gitMainEntry } from "@kilo-desktop/plugin-git/main";
import marketplaceManifest from "@kilo-desktop/plugin-kilo-marketplace/plugin.json";
import { marketplaceMainEntry } from "@kilo-desktop/plugin-kilo-marketplace/main";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import { localInferenceMainEntry } from "@kilo-desktop/plugin-local-inference/main";
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json";
import { notebookMainEntry } from "@kilo-desktop/plugin-notebook/main";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import { sessionsMainEntry } from "@kilo-desktop/plugin-sessions/main";
import workbenchManifest from "@kilo-desktop/plugin-workbench/plugin.json";
import { workbenchMainEntry } from "@kilo-desktop/plugin-workbench/main";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { shellMainEntry } from "@kilo-desktop/plugin-shell/main";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import { telemetryMainEntry } from "@kilo-desktop/plugin-telemetry/main";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json";
import { terminalMainEntry } from "@kilo-desktop/plugin-terminal/main";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import { workspacesMainEntry } from "@kilo-desktop/plugin-workspaces/main";

/** Main-process entries of bundled plugins, by plugin id. Grows one plugin at a time. */
export const MAIN_ENTRIES: Readonly<Record<string, PluginEntry>> = {
	[shellManifest.id]: shellMainEntry,
	[flagsManifest.id]: flagsMainEntry,
	[telemetryManifest.id]: telemetryMainEntry,
	[agentManifest.id]: agentMainEntry,
	[accountManifest.id]: accountMainEntry,
	[workspacesManifest.id]: workspacesMainEntry,
	[sessionsManifest.id]: sessionsMainEntry,
	[workbenchManifest.id]: workbenchMainEntry,
	[chatManifest.id]: chatMainEntry,
	[terminalManifest.id]: terminalMainEntry,
	[gitManifest.id]: gitMainEntry,
	[filesManifest.id]: filesMainEntry,
	[browserManifest.id]: browserMainEntry,
	[environmentsManifest.id]: environmentsMainEntry,
	[notebookManifest.id]: notebookMainEntry,
	[anacondaAccountManifest.id]: anacondaAccountMainEntry,
	[localInferenceManifest.id]: localInferenceMainEntry,
	[marketplaceManifest.id]: marketplaceMainEntry,
	[boardManifest.id]: boardMainEntry,
};

/** Packages of bundled plugins that ship files in `resources/`, by plugin id. */
const ASSET_PACKAGES: Readonly<Record<string, string>> = {
	[agentManifest.id]: "@kilo-desktop/plugin-agent",
	[terminalManifest.id]: "@kilo-desktop/plugin-terminal",
	[environmentsManifest.id]: "@kilo-desktop/plugin-environments",
	[notebookManifest.id]: "@kilo-desktop/plugin-notebook",
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
 * `fetch-cli` stages binaries).
 */
export function bundledPluginRoot(pluginId: string): string | undefined {
	const packageName = ASSET_PACKAGES[pluginId];
	if (!packageName) return undefined;
	const require = createRequire(import.meta.url);
	return path.dirname(require.resolve(`${packageName}/plugin.json`));
}
