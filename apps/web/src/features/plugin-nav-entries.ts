import { PLUGIN_DISCOVERY } from "./features.js";
import { buildPluginNav, type PluginNavEntry } from "./plugin-nav.js";

/** All sidebar nav entries contributed by the bundled plugins, priority-ordered. */
export const PLUGIN_NAV: readonly PluginNavEntry[] = buildPluginNav(PLUGIN_DISCOVERY);
