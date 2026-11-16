import type { PluginDefinitions } from "@kilo-desktop/kernel";

/**
 * kilo.developer's public surface: the Developer settings category, for
 * other plugins' developer-facing settings sections.
 */
export const DEVELOPER_PLUGIN_ID = "kilo.developer";

/** The Developer category's contribution key, for a section's `category`. */
export const DEVELOPER_SETTINGS_CATEGORY = "kilo.developer/developer";

/** The `kernel/flag` the whole plugin runs behind (its manifest `when`); it declares it itself. */
export const DEVELOPER_FLAG = "developer";

export const DEVELOPER_DEFINITIONS: PluginDefinitions = {};
