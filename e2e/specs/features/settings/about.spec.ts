import { test } from "../../../fixtures/features/about.js";

test.describe("About settings @smoke", () => {
	test.beforeEach(async ({ appShellPage, aboutPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAboutSettings();
		await aboutPage.waitForAboutSettled();
	});

	test("verifies about page layout", async ({ aboutPage }) => {
		await aboutPage.verifyPageHeading();
		await aboutPage.verifyPageDescription();
		await aboutPage.verifyVersionSectionVisible();
		await aboutPage.verifySupportSectionVisible();
	});

	test("verifies version details", async ({ aboutPage }) => {
		await aboutPage.verifyVersionNumber();
		await aboutPage.verifyBetaBadge();
	});

	test("verifies update status without an update feed", async ({ aboutPage }) => {
		await aboutPage.verifyUpdatesUnavailableMessage();
		await aboutPage.verifyCheckForUpdatesDisabled();
		await aboutPage.verifyNoUpdateReadyToInstall();
	});

	test("verifies update track", async ({ aboutPage }) => {
		await aboutPage.verifyUpdateTrackRow();
		await aboutPage.verifyUpdateTrackLocked();
	});

	test("verifies support section", async ({ aboutPage }) => {
		await aboutPage.verifySupportHeading();
		await aboutPage.verifyApplicationLogsTitle();
		await aboutPage.verifyKiloConfigTitle();
	});
});
