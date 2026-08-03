import { pluginNav, type PluginDiscovery } from "@anaconda-agentic-desktop/feature-sdk";

import { PLUGIN_DISCOVERY } from "./features.js";

/**
 * A sidebar nav entry declared in a plugin manifest (`contributes.nav`).
 * Pure data — the shell renders it as a link without touching plugin code.
 * `to` may point at one of the plugin's routes or any shell path; the sidebar
 * links through the catch-all route so static shell routes still win at
 * resolution time.
 */
export interface PluginNavEntry {
	pluginId: string;
	/** Destination path, e.g. "/todos". */
	to: string;
	label: string;
	/** Lucide icon name (kebab-case), if declared. */
	icon: string | undefined;
	/** Higher renders first. */
	priority: number;
	/** `to` without the leading slash — the catch-all route's splat param. */
	splat: string;
	/** Stable test id for the nav entry, e.g. "nav-todos". */
	navQaId: string;
}

/** Derive sidebar nav entries from a discovery result, priority-ordered (pure). */
export function buildPluginNav(discovery: PluginDiscovery): PluginNavEntry[] {
	return pluginNav(discovery)
		.map((entry) => {
			const splat = entry.to.slice(1);
			return {
				pluginId: entry.pluginId,
				to: entry.to,
				label: entry.label,
				icon: entry.icon,
				priority: entry.priority,
				splat,
				navQaId: `nav-${splat.replaceAll("/", "-")}`,
			};
		})
		.sort((a, b) => b.priority - a.priority);
}

/** All sidebar nav entries contributed by the bundled plugins, priority-ordered. */
export const PLUGIN_NAV: readonly PluginNavEntry[] = buildPluginNav(PLUGIN_DISCOVERY);
