import { ONBOARDING_VERSION, type OnboardingState } from "../../contracts/onboarding/schemas.js";

/**
 * Dev override that reopens the wizard on every launch regardless of the
 * persisted outcome. Turn on with
 * `VITE_FEATURE_FLAG_OVERRIDES=force-onboarding` in `apps/desktop/.env.local`.
 */
export const FORCE_ONBOARDING_FLAG = "force-onboarding";

export const ONBOARDING_STEPS = [
	"welcome",
	"kilo-sign-in",
	"work-style",
	"workspace",
	"features",
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

/** Steps tracked by the progress bars; the welcome splash sits before them. */
export const PROGRESS_STEPS = ONBOARDING_STEPS.filter(
	(id): id is Exclude<OnboardingStepId, "welcome"> => id !== "welcome",
);

export type OnboardingView = {
	status: "loading" | "hidden" | "visible";
	initialStep: OnboardingStepId;
};

export type ResolveOnboardingInput = {
	state: OnboardingState | null;
	connectionUnavailable: boolean;
	/** Ignore a recorded complete/skip (see {@link FORCE_ONBOARDING_FLAG}). */
	forced: boolean;
};

/**
 * First-run gate: hide once the user has finished or skipped the current
 * onboarding version, or when Kilo is unavailable (browser mode). An outcome
 * recorded against an older version (see `ONBOARDING_VERSION`) shows the
 * wizard again, so existing users get a redesigned flow once. Stay loading when persisted state cannot be read
 * so a fetch error does not reopen the wizard. Existing workspaces do not
 * suppress the overlay — only a recorded complete/skip does. Do not wait for
 * Kilo auth — the sign-in step handles that while the overlay is already up.
 */
export function resolveOnboarding(input: ResolveOnboardingInput): OnboardingView {
	if (input.connectionUnavailable) {
		return { status: "hidden", initialStep: "welcome" };
	}
	if (input.state === null) {
		return { status: "loading", initialStep: "welcome" };
	}
	if (hasFinishedCurrentVersion(input.state) && !input.forced) {
		return { status: "hidden", initialStep: "welcome" };
	}
	return { status: "visible", initialStep: "welcome" };
}

function hasFinishedCurrentVersion(state: OnboardingState): boolean {
	return state.outcome !== null && (state.version ?? 1) >= ONBOARDING_VERSION;
}
