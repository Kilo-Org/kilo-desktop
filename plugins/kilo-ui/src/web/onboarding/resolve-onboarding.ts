import type { OnboardingState } from "../../contracts/onboarding/schemas.js";

export const ONBOARDING_STEPS = ["kilo-sign-in", "workspace"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export type OnboardingView = {
	status: "loading" | "hidden" | "visible";
	initialStep: OnboardingStepId;
};

export type ResolveOnboardingInput = {
	state: OnboardingState | null;
	connectionUnavailable: boolean;
};

/**
 * First-run gate: hide once the user has finished or skipped, or when Kilo is
 * unavailable (browser mode). Stay loading when persisted state cannot be read
 * so a fetch error does not reopen the wizard. Existing workspaces do not
 * suppress the overlay — only a recorded complete/skip does. Do not wait for
 * Kilo auth — the sign-in step handles that while the overlay is already up.
 */
export function resolveOnboarding(input: ResolveOnboardingInput): OnboardingView {
	if (input.connectionUnavailable) {
		return { status: "hidden", initialStep: "kilo-sign-in" };
	}
	if (input.state === null) {
		return { status: "loading", initialStep: "kilo-sign-in" };
	}
	if (input.state.outcome !== null) {
		return { status: "hidden", initialStep: "kilo-sign-in" };
	}
	return { status: "visible", initialStep: "kilo-sign-in" };
}
