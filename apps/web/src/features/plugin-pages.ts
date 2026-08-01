import { pluginRoutes, type PluginDiscovery } from "@anaconda-agentic-desktop/feature-sdk";

import type { PluginPageProps } from "@anaconda-agentic-desktop/feature-sdk";
import type { ComponentType } from "react";

import { PLUGIN_DISCOVERY } from "./features.js";

/**
 * A full-page route declared in a plugin manifest, ready for the shell to
 * render: the shell's catch-all route (routes/$.tsx) mounts `component` when
 * `path` is visited, and AppSidebarLayout derives a nav entry from it.
 * Plugins never touch the router (Decision #19).
 */
export interface PluginPage {
	pluginId: string;
	/** Absolute route path from the manifest, e.g. "/todos". */
	path: string;
	label: string;
	/** Lucide icon name (kebab-case) for the nav entry, if declared. */
	icon: string | undefined;
	component: ComponentType<PluginPageProps>;
	/**
	 * False for Electron-only plugins (main entry, no browserRegister): in
	 * standalone browser mode the shell renders an unavailable state instead
	 * of a dead page.
	 */
	browserSafe: boolean;
	/** `path` without the leading slash — the catch-all route's splat param. */
	splat: string;
	/** Stable test id for the derived nav entry, e.g. "nav-todos". */
	navQaId: string;
}

/** Derive renderable pages from a discovery result (pure — unit-testable). */
export function buildPluginPages(discovery: PluginDiscovery): PluginPage[] {
	return pluginRoutes(discovery).map((route) => {
		const splat = route.path.slice(1);
		return {
			pluginId: route.pluginId,
			path: route.path,
			label: route.label,
			icon: route.icon,
			// The loader verified this export is a function; the shell owns the
			// React-specific interpretation (feature-sdk stays React-free).
			component: route.component as ComponentType<PluginPageProps>,
			browserSafe: route.browserSafe,
			splat,
			navQaId: `nav-${splat.replaceAll("/", "-")}`,
		};
	});
}

export function findPluginPage(pages: readonly PluginPage[], path: string): PluginPage | undefined {
	return pages.find((page) => page.path === path);
}

/** All plugin pages of the bundled plugins, in registration order. */
export const PLUGIN_PAGES: readonly PluginPage[] = buildPluginPages(PLUGIN_DISCOVERY);
