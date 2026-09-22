import { test } from "../fixtures.js";

test.use({ appIsolationKey: "onboarding" });

test.describe("Onboarding", () => {
	test("does not cover the shell in packaged e2e profiles", async ({
		appShellPage,
		onboardingPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await onboardingPage.verifyHidden();
	});
});
