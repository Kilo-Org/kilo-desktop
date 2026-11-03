import type { PluginDefinitions } from "@kilo-desktop/kernel";

/**
 * kilo.developer's public surface: the Developer settings category, for
 * other plugins' developer-facing settings sections.
 */
export const DEVELOPER_PLUGIN_ID = "kilo.developer";

/** The Developer category's contribution key, for a section's `category`. */
export const DEVELOPER_SETTINGS_CATEGORY = "kilo.developer/developer";

export const DEVELOPER_DEFINITIONS: PluginDefinitions = {};
