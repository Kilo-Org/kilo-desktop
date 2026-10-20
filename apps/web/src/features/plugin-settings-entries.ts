import { InfoIcon, KeyboardIcon, PaletteIcon, ShieldIcon } from "lucide-react";

import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { PrivacySettings } from "./privacy/PrivacySettings.js";
import { KeyboardShortcutsSettings } from "./shortcuts/KeyboardShortcutsSettings.js";

import { PLUGIN_DISCOVERY } from "./features.js";
import { buildPluginSettings, type PluginSettingsSection } from "./plugin-settings.js";

const BUILT_IN_SETTINGS: readonly PluginSettingsSection[] = [
	{
		pluginId: "privacy",
		id: "privacy",
		title: "Privacy",
		description: "Control usage analytics and crash reporting on this device.",
		component: PrivacySettings,
		category: "General",
		icon: undefined,
		iconComponent: ShieldIcon,
		priority: 70,
		featureFlag: undefined,
		browserSafe: false,
	},
	{
		pluginId: "shell",
		id: "appearance",
		title: "Appearance",
		description: "Choose how Kilo looks on this device.",
		component: AppearanceSettings,
		category: "General",
		icon: undefined,
		iconComponent: PaletteIcon,
		priority: 100,
		featureFlag: undefined,
		browserSafe: true,
	},
	{
		pluginId: "shell",
		id: "keyboard-shortcuts",
		title: "Shortcuts",
		description: "See, change, or turn off the app's keyboard shortcuts.",
		component: KeyboardShortcutsSettings,
		category: "General",
		icon: undefined,
		iconComponent: KeyboardIcon,
		priority: 65,
		featureFlag: undefined,
		browserSafe: true,
	},
	{
		pluginId: "shell",
		id: "about",
		title: "About",
		description: "Check the app version, manage updates, and find application logs.",
		component: AboutSettings,
		category: "General",
		icon: undefined,
		iconComponent: InfoIcon,
		priority: 110,
		featureFlag: undefined,
		browserSafe: false,
	},
];

/** All settings sections of the bundled plugins, in priority order. */
export const PLUGIN_SETTINGS: readonly PluginSettingsSection[] = buildPluginSettings(
	PLUGIN_DISCOVERY,
	{ builtIn: BUILT_IN_SETTINGS },
);
