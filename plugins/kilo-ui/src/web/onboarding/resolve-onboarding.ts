import type { OnboardingState } from "../../contracts/onboarding/schemas.js";

export const ONBOARDING_STEPS = ["kilo-sign-in", "workspace"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export type OnboardingView = {
	status: "loading" | "hidden" | "visible";
	initialStep: OnboardingStepId;
};

export type ResolveOnboardingInput = {
	state: OnboardingState | null;
	workspaceCount: number | null;
	workspacesLoading: boolean;
	connectionUnavailable: boolean;
};

/**
 * First-run gate: hide once the user has finished or skipped, when Kilo is
 * unavailable (browser mode), or when they already have a workspace (existing
 * install). Do not wait for Kilo auth — the sign-in step handles that while
 * the overlay is already up, so the app does not paint first.
 */
export function resolveOnboarding(input: ResolveOnboardingInput): OnboardingView {
	if (input.connectionUnavailable) {
		return { status: "hidden", initialStep: "kilo-sign-in" };
	}
	if (input.state === null || input.workspacesLoading) {
		return { status: "loading", initialStep: "kilo-sign-in" };
	}
	if (input.state.outcome !== null) {
		return { status: "hidden", initialStep: "kilo-sign-in" };
	}
	if ((input.workspaceCount ?? 0) > 0) {
		return { status: "hidden", initialStep: "workspace" };
	}
	return { status: "visible", initialStep: "kilo-sign-in" };
}
