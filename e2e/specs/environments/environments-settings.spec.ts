import { test } from "../../fixtures/environments.js";
import { environmentsData } from "../../testdata/environments.js";
import { CONDA_ENVIRONMENTS_SECTION } from "../../testdata/settings.js";

test.describe("Conda Environments settings", () => {
	test.beforeEach(async ({ appShellPage, settingsPage, environmentsPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await settingsPage.openSection(CONDA_ENVIRONMENTS_SECTION);
		await environmentsPage.waitForEnvironmentsLoaded();
		await settingsPage.verifySectionOpened(CONDA_ENVIRONMENTS_SECTION);
	});

	test("verifies the environments tab UI @smoke", async ({ environmentsPage }) => {
		await environmentsPage.verifyEnvironmentsTabUi();
		await environmentsPage.verifyEnvironmentListed(environmentsData.seededEnvName);
	});
});
