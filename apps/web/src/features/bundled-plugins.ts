import type { BundledPlugin } from "@kilo-desktop/feature-sdk";

/**
 * Bundled workspace plugins — renderer side (Decision #17).
 *
 * Mirrors apps/desktop/src/main/features/registry/bundled-plugins.ts, which
 * documents the full design: BUNDLED_PLUGINS feeds the existing boot paths
 * (FEATURES / WEB_FEATURES) rather than replacing them, with one registry
 * file per process because main and web entries cannot be imported from the
 * other side's bundle. Keep both registries in sync for plugins that ship
 * both entries.
 *
 * Register each plugin's `web` entry here. Plugins whose web entry exports
 * `browserRegister` also work in standalone browser mode; Electron-only
 * plugins are skipped there with the standard warning.
 */

import anacondaAccountManifest from "@kilo-desktop/plugin-anaconda-account/plugin.json" with { type: "json" };
import * as anacondaAccountWeb from "@kilo-desktop/plugin-anaconda-account/web";
import environmentsManifest from "@kilo-desktop/plugin-environments/plugin.json" with { type: "json" };
import browserManifest from "@kilo-desktop/plugin-browser/plugin.json" with { type: "json" };
import * as browserWeb from "@kilo-desktop/plugin-browser/web";
import * as environmentsWeb from "@kilo-desktop/plugin-environments/web";
import filesManifest from "@kilo-desktop/plugin-files/plugin.json" with { type: "json" };
import * as filesWeb from "@kilo-desktop/plugin-files/web";
import gitManifest from "@kilo-desktop/plugin-git/plugin.json" with { type: "json" };
import * as gitWeb from "@kilo-desktop/plugin-git/web";
import kiloMarketplaceManifest from "@kilo-desktop/plugin-kilo-marketplace/plugin.json" with { type: "json" };
import * as kiloMarketplaceWeb from "@kilo-desktop/plugin-kilo-marketplace/web";
import kiloServerManifest from "@kilo-desktop/plugin-kilo-server/plugin.json" with { type: "json" };
import * as kiloServerWeb from "@kilo-desktop/plugin-kilo-server/web";
import kiloUiManifest from "@kilo-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import * as kiloUiWeb from "@kilo-desktop/plugin-kilo-ui/web";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json" with { type: "json" };
import * as localInferenceWeb from "@kilo-desktop/plugin-local-inference/web";
import notebookManifest from "@kilo-desktop/plugin-notebook/plugin.json" with { type: "json" };
import * as notebookWeb from "@kilo-desktop/plugin-notebook/web";
import todosManifest from "@kilo-desktop/plugin-todos/plugin.json" with { type: "json" };
import * as todosWeb from "@kilo-desktop/plugin-todos/web";
import terminalManifest from "@kilo-desktop/plugin-terminal/plugin.json" with { type: "json" };
import * as terminalWeb from "@kilo-desktop/plugin-terminal/web";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{ manifest: browserManifest, module: browserWeb },
	{ manifest: kiloUiManifest, module: kiloUiWeb },
	{ manifest: kiloServerManifest, module: kiloServerWeb },
	{ manifest: kiloMarketplaceManifest, module: kiloMarketplaceWeb },
	{ manifest: notebookManifest, module: notebookWeb },
	{ manifest: filesManifest, module: filesWeb },
	{ manifest: terminalManifest, module: terminalWeb },
	{ manifest: gitManifest, module: gitWeb },
	{ manifest: todosManifest, module: todosWeb },
	{ manifest: environmentsManifest, module: environmentsWeb },
	{ manifest: localInferenceManifest, module: localInferenceWeb },
	{ manifest: anacondaAccountManifest, module: anacondaAccountWeb },
];
