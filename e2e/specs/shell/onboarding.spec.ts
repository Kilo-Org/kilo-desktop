import { test } from "../../fixtures/shell.js";

// A profile of its own, so the app is on its first run when the test looks.
test.use({ appIsolationKey: "onboarding" });

test.describe("Onboarding", () => {
	test("does not cover the shell in packaged e2e profiles", async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.verifyOnboardingHidden();
	});
});
