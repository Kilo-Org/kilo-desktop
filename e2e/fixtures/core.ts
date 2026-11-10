import { DiagnosticsPage } from "../pages/developer/diagnostics-page.js";
import { AccountPage } from "../pages/shell/account-page.js";
import { AiProvidersPage } from "../pages/shell/ai-providers-page.js";
import { ExternalAiAppsPage } from "../pages/shell/external-ai-apps-page.js";
import { OnboardingPage } from "../pages/shell/onboarding-page.js";
import { SHOW_ONBOARDING_LAUNCH_ENV } from "../testdata/onboarding.js";
import { test as shellTest } from "./shell.js";

/**
 * kilo.core's specs get their own app on a fresh profile that shows first-run
 * onboarding, so the terms are accepted the way a person does: the Kilo server
 * it then starts must not leak into other specs. kilo.core has no UI of its
 * own, so its specs see it through kilo.shell's pages, and what kilo.shell
 * draws nothing for (the identity) through kilo.developer's Diagnostics.
 */
export const test = shellTest.extend<{
	diagnosticsPage: DiagnosticsPage;
	accountPage: AccountPage;
	aiProvidersPage: AiProvidersPage;
	externalAiAppsPage: ExternalAiAppsPage;
	onboardingPage: OnboardingPage;
}>({
	appIsolationKey: "core",
	appLaunchEnv: SHOW_ONBOARDING_LAUNCH_ENV,
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	diagnosticsPage: async ({}, use) => {
		await use(new DiagnosticsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	accountPage: async ({}, use) => {
		await use(new AccountPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	aiProvidersPage: async ({}, use) => {
		await use(new AiProvidersPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	externalAiAppsPage: async ({}, use) => {
		await use(new ExternalAiAppsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	onboardingPage: async ({}, use) => {
		await use(new OnboardingPage());
	},
});

export const { expect } = test;
