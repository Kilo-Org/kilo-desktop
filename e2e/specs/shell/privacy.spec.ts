import { test } from "../../fixtures/shell/privacy.js";

test.describe("Privacy @smoke", () => {
	test("defaults on and keeps the opt-out saved by the host", async ({
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
