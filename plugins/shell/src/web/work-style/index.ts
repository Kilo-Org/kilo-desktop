import type { PluginSdk } from "@kilo-desktop/kernel";
import { KiloWorkStyle } from "@kilo-desktop/plugin-core/contracts";

import { OnboardingStep } from "../../contracts";
import { createWorkStyleStep } from "./work-style-step";

/**
 * The work-style onboarding step, over `kilo.core/work-style`. Without
 * kilo.core there is no work style to apply, and the step can't be skipped,
 * so it is left out.
 */
export function activateWorkStyleStep(sdk: PluginSdk): void {
	if (!sdk.domainObjects.get(KiloWorkStyle)) return;
	sdk.extensions.implement(OnboardingStep, "work-style", createWorkStyleStep(sdk));
}
