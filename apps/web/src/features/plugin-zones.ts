import {
	pluginZoneContributions,
	type PluginDiscovery,
	type ShellZone,
} from "@anaconda-agentic-desktop/feature-sdk";
import type { FeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

import { PLUGIN_DISCOVERY } from "./features.js";

/**
 * A persistent zone widget declared in a plugin manifest (`contributes.zones`).
 * Unlike the page-scoped imperative `sdk.contribute`, these are registered at
 * activation for the plugin lifetime and render whenever the shell exposes the
 * target zone. App-lifetime lifecycle behavior belongs in `contributes.providers`.
 */
export interface PluginZoneContribution {
	pluginId: string;
	zone: ShellZone;
	label: string;
	component: unknown;
	priority: number;
	/** False for Electron-only plugins — omitted in standalone browser mode. */
	browserSafe: boolean;
}

/** Derive persistent zone contributions from a discovery result (pure). */
export function buildPluginZoneContributions(discovery: PluginDiscovery): PluginZoneContribution[] {
	return pluginZoneContributions(discovery).map((contribution) => ({
		pluginId: contribution.pluginId,
		// The loader validated this against the canonical ShellZone ids.
		zone: contribution.zone as ShellZone,
		label: contribution.label,
		component: contribution.component,
		priority: contribution.priority,
		browserSafe: contribution.browserSafe,
	}));
}

type RegisterOptions = {
	/** Whether the Electron bridge is available (gates Electron-only widgets). */
	desktopAvailable: boolean;
};

/**
 * Mount declarative zone contributions into the shell at boot. Registers each
 * through the owning plugin's cached SDK instance (never torn down on unmount),
 * so the widget persists for the app's lifetime and is cleaned up only on
 * plugin unload. Electron-only widgets are skipped in standalone browser mode
 * (their backend calls would fail). Returns the number registered.
 */
export function registerPluginZoneContributions(
	system: FeatureSystem,
	contributions: readonly PluginZoneContribution[],
	{ desktopAvailable }: RegisterOptions,
): number {
	let registered = 0;
	for (const contribution of contributions) {
		if (!contribution.browserSafe && !desktopAvailable) continue;
		system.getSdk(contribution.pluginId).contribute(contribution.zone, {
			component: contribution.component,
			label: contribution.label,
			priority: contribution.priority,
		});
		registered += 1;
	}
	return registered;
}

/** All persistent zone contributions of the bundled plugins, in registration order. */
export const PLUGIN_ZONE_CONTRIBUTIONS: readonly PluginZoneContribution[] =
	buildPluginZoneContributions(PLUGIN_DISCOVERY);
