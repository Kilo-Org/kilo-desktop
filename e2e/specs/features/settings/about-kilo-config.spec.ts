import { test } from "../../../fixtures/features/about.js";
import { aboutData } from "../../../testdata/about.js";

// The Kilo config row is contributed to About → Support by kilo.agent.
test.describe("About settings: Kilo config", () => {
	test.beforeEach(async ({ appShellPage, aboutPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAboutSettings();
		await aboutPage.waitForAboutSettled();
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
