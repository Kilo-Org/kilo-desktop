import { test } from "../../../fixtures/features/about.js";
import { aboutData } from "../../../testdata/about.js";

test.describe("About settings", () => {
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

	test("verifies kilo config row when the global kilo.jsonc does not exist", async ({
		aboutPage,
	}) => {
		await aboutPage.verifyKiloConfigTitle();
		await aboutPage.verifyKiloConfigNotCreated();
		await aboutPage.verifyShowKiloConfigButtonDisabled();
	});

	test("shows the existing global kilo.jsonc path, enables show in file manager, and reveals that exact file", async ({
		appShellPage,
		aboutPage,
		globalKiloConfigPath,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAboutSettings();
		await aboutPage.waitForAboutSettled();
		await aboutPage.verifyKiloConfigPath(globalKiloConfigPath);
		await aboutPage.verifyShowKiloConfigButtonEnabled();
		await aboutPage.clickShowKiloConfig();
		await aboutPage.verifyRevealedFilePath(globalKiloConfigPath, aboutData.kiloConfigRevealMessage);
		await aboutPage.verifyRevealedFileExists();
	});
});
