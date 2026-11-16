import { ActivityIcon } from "lucide-react";

import { definePlugin } from "@kilo-desktop/kernel";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { DiagnosticsSettings } from "./diagnostics/DiagnosticsSettings";

/**
 * kilo.developer's renderer entry: Settings → Developer → Diagnostics (the
 * category and the flags it declares are manifest-only).
 */
export const developerWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, "diagnostics", {
			component: DiagnosticsSettings,
			icon: ActivityIcon,
		});
	},
});
