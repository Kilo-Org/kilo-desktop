import { test } from "../../fixtures/shell/about.js";
import { aboutData } from "../../testdata/about.js";

test.describe("About settings", () => {
	test.beforeEach(async ({ appShellPage, aboutPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAboutSettings();
		await aboutPage.waitForAboutSettled();
	});

	test("reads the version and update state and offers the application logs @smoke @packaged", async ({
		aboutPage,
	}) => {
		await aboutPage.verifyVersionNumber();
		await aboutPage.verifyUpdatesUnavailableMessage();
		await aboutPage.verifyUpdateTrackLocked();
		await aboutPage.verifyShowLogFileButton();
	});

	test("offers the terms of service and shows the third-party notices the app ships @smoke @packaged", async ({
		aboutPage,
	}) => {
		await aboutPage.verifyLegalSection();
		await aboutPage.verifyTermsOfServiceOffered();
		await aboutPage.verifyThirdPartyNoticesShown();
		await aboutPage.clickShowChromiumNotices();
		await aboutPage.verifyRevealedFilePath(
			aboutData.chromiumNoticesPathPattern,
			aboutData.chromiumNoticesRevealMessage,
		);
		await aboutPage.verifyRevealedFileExists();
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
	});

	test("verifies application logs row", async ({ aboutPage }) => {
		await aboutPage.verifyApplicationLogsTitle();
		await aboutPage.verifyLogFilePath();
		await aboutPage.verifyShowLogFileButton();
	});

	test("show in file manager reveals the log file path shown in the Application logs row", async ({
		aboutPage,
	}) => {
		await aboutPage.clickShowLogFile();
		await aboutPage.verifyRevealedFilePath(
			aboutData.logFilePathPattern,
			aboutData.logFileRevealMessage,
		);
		await aboutPage.verifyLogFileRevealed();
		await aboutPage.verifyRevealedFileExists();
	});
});
