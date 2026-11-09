import { definePlugin } from "@kilo-desktop/kernel";
import { OnboardingStep, SettingsSection, SupportRow } from "@kilo-desktop/plugin-shell/contracts";

import { ExternalAiAppsNavIcon } from "./external-apps/ExternalAiAppsNavIcon";
import { ExternalAiAppsSettings } from "./external-apps/ExternalAiAppsSettings";
import { createWorkStyleStep } from "./onboarding/work-style-step";
import { AiProvidersPage } from "./providers/AiProvidersPage";
import { KiloProvidersNavIcon } from "./providers/KiloProvidersNavIcon";
import { toastServerFailures } from "./server-failure-toast";
import { KiloConfigRow } from "./settings/KiloConfigRow";

/**
 * kilo.agent's renderer entry: AI Providers and External AI apps settings,
 * the work-style onboarding step, the Kilo config row and server failure toasts.
 */
export const agentWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SupportRow, "kilo-config", KiloConfigRow);
		sdk.extensions.implement(OnboardingStep, "work-style", createWorkStyleStep(sdk));
		sdk.extensions.implement(SettingsSection, "kilo-providers", {
			component: AiProvidersPage,
			icon: KiloProvidersNavIcon,
		});
		sdk.extensions.implement(SettingsSection, "external-ai-apps", {
			component: ExternalAiAppsSettings,
			icon: ExternalAiAppsNavIcon,
		});
		if (!sdk.context.get("kernel/secondaryWindow")) toastServerFailures(sdk);
	},
});
