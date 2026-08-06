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

import kiloServerManifest from "@anaconda-agentic-desktop/plugin-kilo-server/plugin.json" with { type: "json" };
import * as kiloServerWeb from "@anaconda-agentic-desktop/plugin-kilo-server/web";
import kiloUiManifest from "@anaconda-agentic-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import * as kiloUiWeb from "@anaconda-agentic-desktop/plugin-kilo-ui/web";
import todosManifest from "@anaconda-agentic-desktop/plugin-todos/plugin.json" with { type: "json" };
import * as todosWeb from "@anaconda-agentic-desktop/plugin-todos/web";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{ manifest: kiloUiManifest, module: kiloUiWeb },
	{ manifest: kiloServerManifest, module: kiloServerWeb },
	{ manifest: todosManifest, module: todosWeb },
];
