import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import { PaletteIcon } from "lucide-react";

import {
	pluginSettingsContributions,
	type PluginDiscovery,
} from "@anaconda-agentic-desktop/feature-sdk";
import { useFeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";

import { PLUGIN_DISCOVERY } from "./features.js";

/**
 * A settings-page section declared in a plugin manifest (`contributes.settings`)
 * or supplied as a built-in shell section. The host mounts `component` at
 * `/settings/$id` and lists it in the settings nav.
 */
export interface PluginSettingsSection {
	pluginId: string;
	/** URL slug, unique across plugins and built-ins. */
	id: string;
	title: string;
	component: ComponentType;
	icon: string | undefined;
	iconComponent: ComponentType | undefined;
	/** Higher renders first. */
	priority: number;
	featureFlag: string | undefined;
	/** False for Electron-only plugins — omitted in standalone browser mode. */
	browserSafe: boolean;
}

type BuildOptions = {
	/**
	 * Shell-owned sections merged ahead of plugin contributions. Appearance
	 * is registered here; other built-ins (e.g. Anaconda MCP) can join later.
	 */
	builtIn?: readonly PluginSettingsSection[];
};

const BUILT_IN_SETTINGS: readonly PluginSettingsSection[] = [
	{
		pluginId: "shell",
		id: "appearance",
		title: "Appearance",
		component: AppearanceSettings,
		icon: undefined,
		iconComponent: PaletteIcon,
		priority: 100,
		featureFlag: undefined,
		browserSafe: true,
	},
];

/** Derive settings sections from a discovery result, priority-ordered (pure). */
export function buildPluginSettings(
	discovery: PluginDiscovery,
	{ builtIn = [] }: BuildOptions = {},
): PluginSettingsSection[] {
	const fromPlugins = pluginSettingsContributions(discovery).map((section) => ({
		pluginId: section.pluginId,
		id: section.id,
		title: section.title,
		component: section.component as ComponentType,
		icon: section.icon,
		iconComponent: section.iconComponent as ComponentType | undefined,
		priority: section.priority,
		featureFlag: section.featureFlag,
		browserSafe: section.browserSafe,
	}));
	return [...builtIn, ...fromPlugins].sort((a, b) => b.priority - a.priority);
}

/**
 * Filter settings sections for the settings nav. Sections without a
 * `featureFlag` are always visible (when browser-safe); flag-gated sections
 * require a truthy flag. Electron-only sections are omitted in browser mode.
 *
 * Direct `/settings/$id` visits still mount a flag-gated section — this filter
 * is nav-only, matching `contributes.nav`.
 */
export function filterVisiblePluginSettings(
	sections: readonly PluginSettingsSection[],
	flags: Record<string, unknown>,
	desktopAvailable: boolean,
): PluginSettingsSection[] {
	return sections.filter((section) => {
		if (!section.browserSafe && !desktopAvailable) return false;
		if (section.featureFlag === undefined) return true;
		return Boolean(flags[section.featureFlag]);
	});
}

/** All settings sections of the bundled plugins, in priority order. */
export const PLUGIN_SETTINGS: readonly PluginSettingsSection[] = buildPluginSettings(
	PLUGIN_DISCOVERY,
	{ builtIn: BUILT_IN_SETTINGS },
);

/**
 * Subscribe to the feature-flag store and return the subset of `sections`
 * visible in the settings nav right now. Re-renders only when a flag
 * referenced by one of the sections actually changes value.
 */
export function useVisiblePluginSettings(
	sections: readonly PluginSettingsSection[] = PLUGIN_SETTINGS,
	desktopAvailable: boolean = isDesktopBridgeAvailable(),
): readonly PluginSettingsSection[] {
	const { featureFlags } = useFeatureSystem().services.shellDelegates;

	const requiredKeys = useMemo(() => {
		const seen = new Set<string>();
		for (const section of sections) {
			if (section.featureFlag !== undefined) seen.add(section.featureFlag);
		}
		return [...seen].sort();
	}, [sections]);

	const getSnapshot = useCallback(() => {
		if (requiredKeys.length === 0) return "";
		const flags = featureFlags.peek();
		return requiredKeys.map((key) => `${key}=${flags[key] ? "1" : "0"}`).join("|");
	}, [featureFlags, requiredKeys]);

	const signature = useSyncExternalStore(featureFlags.subscribe, getSnapshot);

	return useMemo(() => {
		void signature;
		return filterVisiblePluginSettings(sections, featureFlags.peek(), desktopAvailable);
	}, [sections, featureFlags, signature, desktopAvailable]);
}

export function findSettingsSection(
	sections: readonly PluginSettingsSection[],
	id: string,
): PluginSettingsSection | undefined {
	return sections.find((section) => section.id === id);
}

/** Whether the current location is the shell-owned settings takeover. */
export function isSettingsPath(pathname: string): boolean {
	return pathname === "/settings" || pathname.startsWith("/settings/");
}
