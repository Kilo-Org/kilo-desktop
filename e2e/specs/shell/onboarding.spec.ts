import { test } from "../../fixtures/shell/onboarding.js";

test.describe("Onboarding", () => {
	test("walks a fresh profile through the terms, sign-in, work style and workspace steps", async ({
		appShellPage,
		onboardingPage,
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
	});
});
