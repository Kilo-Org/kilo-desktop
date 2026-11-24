import { PuzzleIcon } from "lucide-react";

import type { PluginSdk } from "@kilo-desktop/kernel";

import { SettingsSection } from "../../contracts";
import { LocalPluginsSettings } from "./LocalPluginsSettings";

/** Settings → Plugins, over `kernel/plugins`' local plugins. */
export function activateLocalPlugins(sdk: PluginSdk): void {
	sdk.extensions.implement(SettingsSection, "local-plugins", {
		component: LocalPluginsSettings,
		icon: PuzzleIcon,
	});
}
