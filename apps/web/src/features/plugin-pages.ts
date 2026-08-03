import {
	PLUGIN_ROUTE_NAMESPACE,
	pluginRoutes,
	type PluginDiscovery,
} from "@anaconda-agentic-desktop/feature-sdk";

import type { PluginPageProps } from "@anaconda-agentic-desktop/feature-sdk";
import type { ComponentType } from "react";

import { PLUGIN_DISCOVERY } from "./features.js";

/**
 * A full-page route declared in a plugin manifest (`contributes.routes`),
 * ready for the shell to render: the shell's catch-all route
 * (routes/plugins/$.tsx) mounts `component` when `path` is visited. Plugins
 * never touch the router (Decision #19); navigation entries are separate
 * (`contributes.nav`).
 */
export interface PluginPage {
	pluginId: string;
	/** Full resolved route path, e.g. "/plugins/todos". */
	path: string;
	/** Optional page title for the browser-mode unavailable state. */
	title: string | undefined;
	component: ComponentType<PluginPageProps>;
	/**
	 * False for Electron-only plugins (main entry, no browserRegister): in
	 * standalone browser mode the shell renders an unavailable state instead
	 * of a dead page.
	 */
	browserSafe: boolean;
	/**
	 * `path` with the `/plugins/` prefix stripped — the catch-all route's
	 * splat param (e.g. `"todos"` for `/plugins/todos`).
	 */
	splat: string;
}

const PLUGIN_ROUTE_PREFIX = `${PLUGIN_ROUTE_NAMESPACE}/`;

/** Derive renderable pages from a discovery result (pure — unit-testable). */
export function buildPluginPages(discovery: PluginDiscovery): PluginPage[] {
	return pluginRoutes(discovery).map((route) => ({
		pluginId: route.pluginId,
		path: route.path,
		title: route.title,
		// The loader verified this export is a function; the shell owns the
		// React-specific interpretation (feature-sdk stays React-free).
		component: route.component as ComponentType<PluginPageProps>,
		browserSafe: route.browserSafe,
		splat: route.path.startsWith(PLUGIN_ROUTE_PREFIX)
			? route.path.slice(PLUGIN_ROUTE_PREFIX.length)
			: route.path.replace(/^\//, ""),
	}));
}

export function findPluginPage(pages: readonly PluginPage[], path: string): PluginPage | undefined {
	return pages.find((page) => page.path === path);
}

/** All plugin pages of the bundled plugins, in registration order. */
export const PLUGIN_PAGES: readonly PluginPage[] = buildPluginPages(PLUGIN_DISCOVERY);
