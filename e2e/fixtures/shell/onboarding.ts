import { OnboardingPage } from "../../pages/shell/onboarding-page.js";
import { SHOW_ONBOARDING_LAUNCH_ENV } from "../../testdata/onboarding.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ onboardingPage: OnboardingPage }>({
	// A fresh profile of its own that shows first-run onboarding: nothing accepted, nothing skipped.
	appIsolationKey: "onboarding",
	appLaunchEnv: SHOW_ONBOARDING_LAUNCH_ENV,
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	onboardingPage: async ({}, use) => {
		await use(new OnboardingPage());
	},
});

export const { expect } = test;
