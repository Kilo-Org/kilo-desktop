import {
	pluginZoneContributions,
	type ContributionMountPolicy,
	type PluginDiscovery,
} from "@kilo-desktop/feature-sdk";
import type { FeatureSystem } from "@kilo-desktop/sdk-react";

import { PLUGIN_DISCOVERY } from "./features.js";

/**
 * A persistent zone contribution declared in a plugin manifest (`contributes.zones`).
 * Unlike the page-scoped imperative `sdk.contribute`, these are registered at
 * activation for the plugin lifetime. Shell zones render components directly;
 * plugin-owned hosts may interpret them as richer definitions. App-lifetime
 * lifecycle behavior belongs in `contributes.providers`.
 */
export interface PluginZoneContribution {
	pluginId: string;
	id: string;
	zone: string;
	label: string;
	description?: string | undefined;
	component: unknown;
	icon?: unknown | undefined;
	mountPolicy?: ContributionMountPolicy | undefined;
	priority: number;
	/** False for Electron-only plugins — omitted in standalone browser mode. */
	browserSafe: boolean;
}

/** Derive persistent zone contributions from a discovery result (pure). */
export function buildPluginZoneContributions(discovery: PluginDiscovery): PluginZoneContribution[] {
	return pluginZoneContributions(discovery).map((contribution) => ({
		pluginId: contribution.pluginId,
		id: contribution.id,
		zone: contribution.zone,
		label: contribution.label,
		...(contribution.description === undefined ? {} : { description: contribution.description }),
		component: contribution.component,
		...(contribution.icon === undefined ? {} : { icon: contribution.icon }),
		...(contribution.mountPolicy === undefined ? {} : { mountPolicy: contribution.mountPolicy }),
		priority: contribution.priority,
		browserSafe: contribution.browserSafe,
	}));
}

type RegisterOptions = {
	/** Whether the Electron bridge is available (gates Electron-only widgets). */
	desktopAvailable: boolean;
};

/**
 * Register declarative zone contributions at boot. Registers each
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
			id: contribution.id,
			component: contribution.component,
			label: contribution.label,
			...(contribution.description === undefined ? {} : { description: contribution.description }),
			...(contribution.icon === undefined ? {} : { icon: contribution.icon }),
			...(contribution.mountPolicy === undefined ? {} : { mountPolicy: contribution.mountPolicy }),
			priority: contribution.priority,
		});
		registered += 1;
	}
	return registered;
}

/** All persistent zone contributions of bundled plugins, in registration order. */
export const PLUGIN_ZONE_CONTRIBUTIONS: readonly PluginZoneContribution[] =
	buildPluginZoneContributions(PLUGIN_DISCOVERY);
