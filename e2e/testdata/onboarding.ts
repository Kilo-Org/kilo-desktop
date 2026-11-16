import { SHOW_ONBOARDING_ENV } from "../utils/app-launcher.js";

/**
 * First-run onboarding as kilo.shell draws it: the welcome (terms) splash,
 * sign-in, work style and features steps.
 */
export const onboardingData = {
	/** `package:e2e` (`VITE_KILO_E2E_AUTH=1`) signs kilo.core in as this account. */
	e2eEmail: "e2e@kilo.dev",
	/** High autonomy writes no permission rules to the profile's Kilo config. */
	workStyle: "autonomous",
	/**
	 * Accepting the terms starts the Kilo server; the account it reads, and so
	 * the sign-in step, settle once its cold start (over a minute on CI) is done.
	 */
	signedInTimeoutMs: 120_000,
} as const;

/** Launch env for an app that shows first-run onboarding on its fresh profile. */
export const SHOW_ONBOARDING_LAUNCH_ENV = { [SHOW_ONBOARDING_ENV]: "1" };
