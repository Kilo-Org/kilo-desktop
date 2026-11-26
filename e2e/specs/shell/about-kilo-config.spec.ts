import { test } from "../../fixtures/shell/about.js";
import { aboutData } from "../../testdata/about.js";

// The Kilo config row in About → Support reads kilo.core's server.
test.describe("About settings: Kilo config", () => {
	test.beforeEach(async ({ appShellPage, aboutPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAboutSettings();
		await aboutPage.waitForAboutSettled();
	});

	test("verifies kilo config row when the global kilo2.jsonc does not exist", async ({
		aboutPage,
	}) => {
		await aboutPage.verifyKiloConfigTitle();
		await aboutPage.verifyKiloConfigNotCreated();
		await aboutPage.verifyShowKiloConfigButtonDisabled();
	});

	test("shows the existing global kilo2.jsonc path, enables show in file manager, and reveals that exact file", async ({
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
