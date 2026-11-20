import { test } from "../../fixtures/core.js";
import { coreData } from "../../testdata/core.js";

test.describe("kilo.core @smoke @packaged", () => {
	test("starts the packaged Kilo server once the terms are accepted and signs in the e2e identity", async ({
		appShellPage,
		onboardingPage,
		externalAiAppsPage,
		aiProvidersPage,
		accountPage,
		diagnosticsPage,
	}) => {
		test.setTimeout(240_000);
		await onboardingPage.verifyWelcomeShown();
		await onboardingPage.acceptTerms();
		await onboardingPage.verifySignedInAsE2eIdentity();
		await onboardingPage.continueToNextStep();
		await onboardingPage.chooseWorkStyle();
		await onboardingPage.skipWorkspace();
		await onboardingPage.verifyClosed();

		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await externalAiAppsPage.verifyOfferedInSettings();
		await aiProvidersPage.openFromSettings();
		await aiProvidersPage.verifyProvidersListed(coreData.serverReadyTimeoutMs);
		await appShellPage.openAccountSettings();
		await accountPage.waitForAccountSettled();
		await accountPage.verifyKiloSignedInEmail();

		await diagnosticsPage.open();
		await diagnosticsPage.openIdentity();
		await diagnosticsPage.verifyPrimaryIdentity(
			{ source: coreData.identitySource, email: coreData.e2eEmail },
			coreData.settleTimeoutMs,
		);
	});
});
