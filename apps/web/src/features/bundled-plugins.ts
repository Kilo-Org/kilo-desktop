import type { BundledPlugin } from "@anaconda-agentic-desktop/feature-sdk";

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

import environmentsManifest from "@anaconda-agentic-desktop/plugin-environments/plugin.json" with { type: "json" };
import * as environmentsWeb from "@anaconda-agentic-desktop/plugin-environments/web";
import filesManifest from "@anaconda-agentic-desktop/plugin-files/plugin.json" with { type: "json" };
import * as filesWeb from "@anaconda-agentic-desktop/plugin-files/web";
import gitManifest from "@anaconda-agentic-desktop/plugin-git/plugin.json" with { type: "json" };
import * as gitWeb from "@anaconda-agentic-desktop/plugin-git/web";
import kiloServerManifest from "@anaconda-agentic-desktop/plugin-kilo-server/plugin.json" with { type: "json" };
import * as kiloServerWeb from "@anaconda-agentic-desktop/plugin-kilo-server/web";
import kiloUiManifest from "@anaconda-agentic-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import * as kiloUiWeb from "@anaconda-agentic-desktop/plugin-kilo-ui/web";
import localInferenceManifest from "@anaconda-agentic-desktop/plugin-local-inference/plugin.json" with { type: "json" };
import * as localInferenceWeb from "@anaconda-agentic-desktop/plugin-local-inference/web";
import notebookManifest from "@anaconda-agentic-desktop/plugin-notebook/plugin.json" with { type: "json" };
import * as notebookWeb from "@anaconda-agentic-desktop/plugin-notebook/web";
import todosManifest from "@anaconda-agentic-desktop/plugin-todos/plugin.json" with { type: "json" };
import * as todosWeb from "@anaconda-agentic-desktop/plugin-todos/web";
import terminalManifest from "@anaconda-agentic-desktop/plugin-terminal/plugin.json" with { type: "json" };
import * as terminalWeb from "@anaconda-agentic-desktop/plugin-terminal/web";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{ manifest: kiloUiManifest, module: kiloUiWeb },
	{ manifest: kiloServerManifest, module: kiloServerWeb },
	{ manifest: notebookManifest, module: notebookWeb },
	{ manifest: filesManifest, module: filesWeb },
	{ manifest: terminalManifest, module: terminalWeb },
	{ manifest: gitManifest, module: gitWeb },
	{ manifest: todosManifest, module: todosWeb },
	{ manifest: environmentsManifest, module: environmentsWeb },
	{ manifest: localInferenceManifest, module: localInferenceWeb },
];
