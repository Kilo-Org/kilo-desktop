import { test } from "../../fixtures/environments.js";
import { environmentsData } from "../../testdata/environments.js";
import { CONDA_ENVIRONMENTS_SECTION } from "../../testdata/settings.js";

// The section is behind the `environments-feature` flag; builds that do not force it on
// (package:e2e today) skip these instead of failing on a missing settings entry.
test.describe("Conda Environments settings", () => {
	test.beforeEach(async ({ appShellPage, settingsPage, environmentsPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		test.skip(
			!(await settingsPage.isSectionListed(CONDA_ENVIRONMENTS_SECTION)),
			environmentsData.flagOffSkipReason,
		);
		await settingsPage.openSection(CONDA_ENVIRONMENTS_SECTION);
		await environmentsPage.waitForEnvironmentsLoaded();
		await settingsPage.verifySectionOpened(CONDA_ENVIRONMENTS_SECTION);
	});

	test("verifies the environments tab UI @smoke", async ({ environmentsPage }) => {
		await environmentsPage.verifyEnvironmentsTabUi();
		await environmentsPage.verifyEnvironmentListed(environmentsData.seededEnvName);
	});
});
