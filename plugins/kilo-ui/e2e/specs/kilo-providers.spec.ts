import { test } from "../fixtures.js";

test.describe("Kilo provider settings @smoke", () => {
	test("opens the Providers settings section", async ({ appShellPage, kiloProvidersPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await kiloProvidersPage.openFromSettings();
		await kiloProvidersPage.verifyLoaded();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
