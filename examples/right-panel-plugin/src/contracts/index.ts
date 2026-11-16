import type { PluginDefinitions } from "@kilo-desktop/kernel";

/**
 * example.right-panel's public surface. It only contributes to another
 * plugin's extension point, so it declares nothing for other plugins.
 */
export const RIGHT_PANEL_PLUGIN_ID = "example.right-panel";

/** What the kernel needs to know about this plugin without running it. */
export const RIGHT_PANEL_DEFINITIONS: PluginDefinitions = {};
