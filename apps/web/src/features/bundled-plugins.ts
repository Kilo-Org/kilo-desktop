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

import kiloCodeManifest from "@anaconda-agentic-desktop/plugin-kilo-code/plugin.json" with { type: "json" };
import * as kiloCodeWeb from "@anaconda-agentic-desktop/plugin-kilo-code/web";
import todosManifest from "@anaconda-agentic-desktop/plugin-todos/plugin.json" with { type: "json" };
import * as todosWeb from "@anaconda-agentic-desktop/plugin-todos/web";
import workspacesManifest from "@anaconda-agentic-desktop/plugin-workspaces/plugin.json" with { type: "json" };
import * as workspacesWeb from "@anaconda-agentic-desktop/plugin-workspaces/web";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{ manifest: workspacesManifest, module: workspacesWeb },
	{ manifest: kiloCodeManifest, module: kiloCodeWeb },
	{ manifest: todosManifest, module: todosWeb },
];
