import { test } from "../../fixtures/shell.js";

test.describe("Settings", () => {
	test("opens Appearance settings from the app bar", async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.verifyAppearanceSettings();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
