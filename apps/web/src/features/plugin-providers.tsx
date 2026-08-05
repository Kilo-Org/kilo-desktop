import { createElement, type ComponentType, type ReactNode } from "react";

import {
	pluginProviderContributions,
	type PluginDiscovery,
} from "@anaconda-agentic-desktop/feature-sdk";

import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";

import { PLUGIN_DISCOVERY } from "./features.js";

export interface PluginProviderContribution {
	pluginId: string;
	component: unknown;
	/** Higher-priority providers wrap lower-priority providers. */
	priority: number;
	/** False for Electron-only plugins — omitted in standalone browser mode. */
	browserSafe: boolean;
}

/** Derive app-lifetime providers from a plugin discovery result. */
export function buildPluginProviders(discovery: PluginDiscovery): PluginProviderContribution[] {
	return pluginProviderContributions(discovery).map((provider) => ({ ...provider }));
}

type PluginProviderStackProps = {
	children: ReactNode;
	providers?: readonly PluginProviderContribution[];
	desktopAvailable?: boolean;
};

/**
 * Compose plugin providers inside the shell's SDK and query providers.
 * Higher-priority providers are outermost; equal priorities keep registry order.
 */
export function PluginProviderStack({
	children,
	providers = PLUGIN_PROVIDERS,
	desktopAvailable = isDesktopBridgeAvailable(),
}: PluginProviderStackProps) {
	const enabled = providers
		.filter((provider) => provider.browserSafe || desktopAvailable)
		.sort((left, right) => right.priority - left.priority);

	return enabled.reduceRight<ReactNode>((content, provider) => {
		const Provider = provider.component as ComponentType<{ children: ReactNode }>;
		return createElement(Provider, null, content);
	}, children);
}

/** All app-lifetime providers from bundled plugins, in registration order. */
export const PLUGIN_PROVIDERS: readonly PluginProviderContribution[] =
	buildPluginProviders(PLUGIN_DISCOVERY);
