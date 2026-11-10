import { test } from "../../fixtures/shell/settings.js";
import { SETTINGS_SECTIONS } from "../../testdata/settings.js";

test.describe("Settings overview", () => {
	test("verifies the settings UI and sections for a signed-in user", async ({
		appShellPage,
		settingsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await settingsPage.clickSettingsIcon();
		await settingsPage.verifySidebar();
		await settingsPage.verifyContentPane();
		await settingsPage.verifySectionGroups();
		await settingsPage.verifySectionEntries();
		for (const section of SETTINGS_SECTIONS) {
			await test.step(`opens ${section.title}`, async () => {
				await settingsPage.openSection(section);
				await settingsPage.verifySectionOpened(section);
			});
		}
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});

	test("verifies the settings UI and sign-in prompts on gated sections for a signed-out user", async ({
		signedOutApp: _signedOutApp,
		appShellPage,
		settingsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await settingsPage.clickSettingsIcon();
		await settingsPage.verifySidebar();
		await settingsPage.verifyContentPane();
		await settingsPage.verifySectionGroups();
		await settingsPage.verifySectionEntries();
		for (const section of SETTINGS_SECTIONS) {
			await test.step(`opens ${section.title}`, async () => {
				await settingsPage.openSection(section);
				await settingsPage.verifySectionOpenedSignedOut(section);
			});
		}
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
