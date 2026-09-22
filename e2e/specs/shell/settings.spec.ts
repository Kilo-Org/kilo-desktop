import { test } from "../../fixtures/shell.js";

test.describe("Settings", () => {
	test("opens Appearance settings from the app bar", async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.verifyAppearanceSettings();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});

	test("opens Account settings from the settings siderail", async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAccountSettings();
		await appShellPage.verifyAccountSettings();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});

	test("reads automatic update state over the desktop bridge", async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAboutSettings();
		await appShellPage.verifyAboutSettings();
	});
});
