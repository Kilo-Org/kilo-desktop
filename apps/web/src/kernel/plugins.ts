import type { PluginEntry } from "@kilo-desktop/kernel";
import anacondaManifest from "@kilo-desktop/plugin-anaconda/plugin.json";
import { anacondaWebEntry } from "@kilo-desktop/plugin-anaconda/web";
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
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import { localInferenceWebEntry } from "@kilo-desktop/plugin-local-inference/web";
import marketplaceManifest from "@kilo-desktop/plugin-marketplace/plugin.json";
import { marketplaceWebEntry } from "@kilo-desktop/plugin-marketplace/web";
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json";
import { notebookWebEntry } from "@kilo-desktop/plugin-notebook/web";
import pagesManifest from "@kilo-desktop/plugin-pages/plugin.json";
import { pagesWebEntry } from "@kilo-desktop/plugin-pages/web";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { shellWebEntry } from "@kilo-desktop/plugin-shell/web";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json";
import { terminalWebEntry } from "@kilo-desktop/plugin-terminal/web";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { workSessionsWebEntry } from "@kilo-desktop/plugin-work-sessions/web";
import boardManifest from "@kilo-desktop/plugin-workspace-board/plugin.json";
import { boardWebEntry } from "@kilo-desktop/plugin-workspace-board/web";

/** Renderer entries of bundled plugins, by plugin id. Grows one plugin at a time. */
export const WEB_ENTRIES: Readonly<Record<string, PluginEntry>> = {
	[shellManifest.id]: shellWebEntry,
	[workSessionsManifest.id]: workSessionsWebEntry,
	[chatManifest.id]: chatWebEntry,
	[gitManifest.id]: gitWebEntry,
	[filesManifest.id]: filesWebEntry,
	[terminalManifest.id]: terminalWebEntry,
	[browserManifest.id]: browserWebEntry,
	[notebookManifest.id]: notebookWebEntry,
	[pagesManifest.id]: pagesWebEntry,
	[marketplaceManifest.id]: marketplaceWebEntry,
	[localInferenceManifest.id]: localInferenceWebEntry,
	[environmentsManifest.id]: environmentsWebEntry,
	[anacondaManifest.id]: anacondaWebEntry,
	[boardManifest.id]: boardWebEntry,
	[developerManifest.id]: developerWebEntry,
};
