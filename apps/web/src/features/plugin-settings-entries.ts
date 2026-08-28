import { InfoIcon, PaletteIcon } from "lucide-react";

import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { AboutSettings } from "@/components/settings/AboutSettings";

import { PLUGIN_DISCOVERY } from "./features.js";
import { buildPluginSettings, type PluginSettingsSection } from "./plugin-settings.js";

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
	{
		pluginId: "shell",
		id: "about",
		title: "About",
		component: AboutSettings,
		icon: undefined,
		iconComponent: InfoIcon,
		priority: 10,
		featureFlag: undefined,
		browserSafe: false,
	},
];

/** All settings sections of the bundled plugins, in priority order. */
export const PLUGIN_SETTINGS: readonly PluginSettingsSection[] = buildPluginSettings(
	PLUGIN_DISCOVERY,
	{ builtIn: BUILT_IN_SETTINGS },
);
