import { PaletteIcon } from "lucide-react";

import { AppearanceSettings } from "@/components/settings/AppearanceSettings";

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
];

/** All settings sections of the bundled plugins, in priority order. */
export const PLUGIN_SETTINGS: readonly PluginSettingsSection[] = buildPluginSettings(
	PLUGIN_DISCOVERY,
	{ builtIn: BUILT_IN_SETTINGS },
);
