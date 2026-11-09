import { definePlugin } from "@kilo-desktop/kernel";
import { ProviderPanel } from "@kilo-desktop/plugin-agent/contracts";
import {
	AccountPanel,
	LeftSidebarAccount,
	OnboardingStep,
} from "@kilo-desktop/plugin-shell/contracts";

import { signInStep, welcomeStep } from "./onboarding/steps";
import { KiloAccountPanel } from "./settings/KiloAccountPanel";
import { KiloGatewayProviderDisclosure } from "./settings/KiloGatewayProviderCard";
import { SidebarKiloAccount } from "./settings/SidebarKiloAccount";

/** kilo.account's renderer entry: the sidebar account, the Kilo panel in Settings → Account, the Kilo Gateway provider row and onboarding steps. */
export const accountWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(LeftSidebarAccount, "account", SidebarKiloAccount);
		sdk.extensions.implement(AccountPanel, "kilo", KiloAccountPanel);
		sdk.extensions.implement(OnboardingStep, "welcome", welcomeStep);
		sdk.extensions.implement(OnboardingStep, "sign-in", signInStep);
		sdk.extensions.implement(ProviderPanel, "kilo-gateway", KiloGatewayProviderDisclosure);
	},
});
