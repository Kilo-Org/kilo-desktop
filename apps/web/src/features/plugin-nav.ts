import {
	PLUGIN_ROUTE_NAMESPACE,
	pluginNav,
	type PluginDiscovery,
} from "@anaconda-agentic-desktop/feature-sdk";

import { PLUGIN_DISCOVERY } from "./features.js";

/**
 * A sidebar nav entry declared in a plugin manifest (`contributes.nav`).
 * Pure data — the shell renders it as a link without touching plugin code.
 * `to` is the full resolved path (already prefixed with `/plugins/`); the
 * sidebar links through the catch-all route (`/plugins/$`).
 */
export interface PluginNavEntry {
	pluginId: string;
	/** Full resolved destination path, e.g. "/plugins/todos". */
	to: string;
	label: string;
	/** Lucide icon name (kebab-case), if declared. */
	icon: string | undefined;
	/** Higher renders first. */
	priority: number;
	/**
	 * `to` with the `/plugins/` prefix stripped — the catch-all route's splat
	 * param (e.g. `"todos"` for `/plugins/todos`).
	 */
	splat: string;
	/** Stable test id for the nav entry, e.g. "nav-todos". */
	navQaId: string;
}

const PLUGIN_ROUTE_PREFIX = `${PLUGIN_ROUTE_NAMESPACE}/`;

/** Derive sidebar nav entries from a discovery result, priority-ordered (pure). */
export function buildPluginNav(discovery: PluginDiscovery): PluginNavEntry[] {
	return pluginNav(discovery)
		.map((entry) => {
			const splat = entry.to.startsWith(PLUGIN_ROUTE_PREFIX)
				? entry.to.slice(PLUGIN_ROUTE_PREFIX.length)
				: entry.to.replace(/^\//, "");
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
