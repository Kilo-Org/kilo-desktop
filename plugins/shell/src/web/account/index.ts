import type { PluginSdk } from "@kilo-desktop/kernel";

import { KiloAccount, KiloTerms } from "@kilo-desktop/plugin-core/contracts";

import { AccountPanel, AiProviderPanel, OnboardingStep } from "../../contracts";
import { signInStep, welcomeStep } from "./onboarding/steps";
import { KiloAccountPanel } from "./settings/KiloAccountPanel";
import { KiloGatewayProviderDisclosure } from "./settings/KiloGatewayProviderCard";

/**
 * The account area: the Kilo panel in Settings → Account, the Kilo Gateway
 * panel in Settings → AI Providers, and the welcome (terms) and sign-in
 * onboarding steps. The sidebar's account entry (`SidebarAccount`) is drawn
 * by the frame. The onboarding steps need kilo.core: without it there are
 * no terms to accept or account to sign in to, and a required welcome step
 * would cover the app for good, so they are left out.
 */
export function activateAccount(sdk: PluginSdk): void {
	sdk.extensions.implement(AccountPanel, "kilo", KiloAccountPanel);
	sdk.extensions.implement(AiProviderPanel, "kilo-gateway", KiloGatewayProviderDisclosure);
	if (sdk.domainObjects.get(KiloTerms))
		sdk.extensions.implement(OnboardingStep, "welcome", welcomeStep);
	if (sdk.domainObjects.get(KiloAccount))
		sdk.extensions.implement(OnboardingStep, "sign-in", signInStep);
}
