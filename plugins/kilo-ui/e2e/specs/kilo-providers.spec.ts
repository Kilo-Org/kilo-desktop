import { test } from "../fixtures.js";

test.describe("Kilo provider settings @smoke", () => {
	test("opens AI Providers and shows the Kilo Gateway account card", async ({
		appShellPage,
		kiloProvidersPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await kiloProvidersPage.openFromSettings();
		await kiloProvidersPage.verifyKiloLoginOrSignedIn();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
