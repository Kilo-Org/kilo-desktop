import { test } from "../../../fixtures/features/privacy.js";

test.describe("Privacy @smoke", () => {
	test("defaults on and preserves opt-out through the desktop SDK", async ({
		appShellPage,
		privacyPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await privacyPage.open();
		await privacyPage.verifyOn();
		await privacyPage.disable();
		await privacyPage.enable();
		await privacyPage.disable();
		await appShellPage.leaveSettings();
		await appShellPage.openSettings();
		await privacyPage.open();
		await privacyPage.verifyOff();
	});
});
