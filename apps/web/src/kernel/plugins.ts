import type { PluginEntry } from "@kilo-desktop/kernel";
import accountManifest from "@kilo-desktop/plugin-account/plugin.json";
import { accountWebEntry } from "@kilo-desktop/plugin-account/web";
import anacondaAccountManifest from "@kilo-desktop/plugin-anaconda-account/plugin.json";
import { anacondaAccountWebEntry } from "@kilo-desktop/plugin-anaconda-account/web";
import agentManifest from "@kilo-desktop/plugin-agent/plugin.json";
import { agentWebEntry } from "@kilo-desktop/plugin-agent/web";
import boardManifest from "@kilo-desktop/plugin-workspace-board/plugin.json";
import { boardWebEntry } from "@kilo-desktop/plugin-workspace-board/web";
import browserManifest from "@kilo-desktop/plugin-browser/plugin.json";
import { browserWebEntry } from "@kilo-desktop/plugin-browser/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { chatWebEntry } from "@kilo-desktop/plugin-chat/web";
import developerManifest from "@kilo-desktop/plugin-developer/plugin.json";
import { developerWebEntry } from "@kilo-desktop/plugin-developer/web";
import environmentsManifest from "@kilo-desktop/plugin-environments/plugin.json";
import { environmentsWebEntry } from "@kilo-desktop/plugin-environments/web";
import filesManifest from "@kilo-desktop/plugin-files/plugin.json";
import { filesWebEntry } from "@kilo-desktop/plugin-files/web";
import gitManifest from "@kilo-desktop/plugin-git/plugin.json";
import { gitWebEntry } from "@kilo-desktop/plugin-git/web";
import marketplaceManifest from "@kilo-desktop/plugin-kilo-marketplace/plugin.json";
import { marketplaceWebEntry } from "@kilo-desktop/plugin-kilo-marketplace/web";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import { localInferenceWebEntry } from "@kilo-desktop/plugin-local-inference/web";
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json";
import { notebookWebEntry } from "@kilo-desktop/plugin-notebook/web";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import { sessionsWebEntry } from "@kilo-desktop/plugin-sessions/web";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { shellWebEntry } from "@kilo-desktop/plugin-shell/web";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import { telemetryWebEntry } from "@kilo-desktop/plugin-telemetry/web";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json";
import { terminalWebEntry } from "@kilo-desktop/plugin-terminal/web";
import updatesManifest from "@kilo-desktop/plugin-updates/plugin.json";
import { updatesWebEntry } from "@kilo-desktop/plugin-updates/web";
import workbenchManifest from "@kilo-desktop/plugin-workbench/plugin.json";
import { workbenchWebEntry } from "@kilo-desktop/plugin-workbench/web";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import { workspacesWebEntry } from "@kilo-desktop/plugin-workspaces/web";

/** Renderer entries of bundled plugins, by plugin id. Grows one plugin at a time. */
export const WEB_ENTRIES: Readonly<Record<string, PluginEntry>> = {
	[shellManifest.id]: shellWebEntry,
	[telemetryManifest.id]: telemetryWebEntry,
	[updatesManifest.id]: updatesWebEntry,
	[developerManifest.id]: developerWebEntry,
	[agentManifest.id]: agentWebEntry,
	[accountManifest.id]: accountWebEntry,
	[workspacesManifest.id]: workspacesWebEntry,
	[sessionsManifest.id]: sessionsWebEntry,
	[workbenchManifest.id]: workbenchWebEntry,
	[chatManifest.id]: chatWebEntry,
	[terminalManifest.id]: terminalWebEntry,
	[gitManifest.id]: gitWebEntry,
	[filesManifest.id]: filesWebEntry,
	[browserManifest.id]: browserWebEntry,
	[environmentsManifest.id]: environmentsWebEntry,
	[notebookManifest.id]: notebookWebEntry,
	[anacondaAccountManifest.id]: anacondaAccountWebEntry,
	[localInferenceManifest.id]: localInferenceWebEntry,
	[marketplaceManifest.id]: marketplaceWebEntry,
	[boardManifest.id]: boardWebEntry,
};
