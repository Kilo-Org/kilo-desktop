import {
	CircleUserIcon,
	CpuIcon,
	InfoIcon,
	KeyboardIcon,
	PaletteIcon,
	ShieldIcon,
} from "lucide-react";

import type { ComponentType } from "react";

import type { PluginSdk } from "@kilo-desktop/kernel";

import { AboutSection, SettingsSection, type IconComponent } from "../../contracts";
import { AboutSettings } from "./about/AboutSettings";
import { AboutSupportSection } from "./about/AboutSupportSection";
import { AccountSettings } from "./AccountSettings";
import { AiProvidersSettings } from "./AiProvidersSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { PrivacySettings } from "./PrivacySettings";
import { ShortcutsSettings } from "./ShortcutsSettings";

export { SettingsLanding, SettingsLayout, SettingsSectionRoute } from "./SettingsLayout";
export { SettingsSidebar } from "./SettingsSidebar";

/**
 * The settings area: the host (routes, layout and sidebar, exported for the
 * frame) and kilo.shell's own pages. About and Account only frame what other
 * contributions put in them; AI Providers frames the provider panels above
 * the ai-providers area's list.
 */
export function activateSettings(sdk: PluginSdk): void {
	const section = (id: string, component: ComponentType, icon: IconComponent) =>
		sdk.extensions.implement(SettingsSection, id, { component, icon });
	section("appearance", AppearanceSettings, PaletteIcon);
	section("keyboard-shortcuts", ShortcutsSettings, KeyboardIcon);
	section("about", AboutSettings, InfoIcon);
	section("account", AccountSettings, CircleUserIcon);
	section("privacy", PrivacySettings, ShieldIcon);
	section("ai-providers", AiProvidersSettings, CpuIcon);
	sdk.extensions.implement(AboutSection, "support", AboutSupportSection);
}
