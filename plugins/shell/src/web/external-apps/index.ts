import type { PluginSdk } from "@kilo-desktop/kernel";

import { SettingsSection } from "../../contracts";
import { ExternalAiAppsNavIcon } from "./ExternalAiAppsNavIcon";
import { ExternalAiAppsSettings } from "./ExternalAiAppsSettings";

/** Settings → External AI apps, over `kilo.core/external-apps`. */
export function activateExternalApps(sdk: PluginSdk): void {
	sdk.extensions.implement(SettingsSection, "external-ai-apps", {
		component: ExternalAiAppsSettings,
		icon: ExternalAiAppsNavIcon,
	});
}
