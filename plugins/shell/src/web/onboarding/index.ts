import type { PluginSdk } from "@kilo-desktop/kernel";

import { OnboardingStep } from "../../contracts";
import { featuresStep } from "./features-step";

export { OnboardingHost } from "./OnboardingHost";

/** The onboarding area: the host the frame mounts (exported) and the closing `features` step. */
export function activateOnboarding(sdk: PluginSdk): void {
	sdk.extensions.implement(OnboardingStep, "features", featuresStep);
}
