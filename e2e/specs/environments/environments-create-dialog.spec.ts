import { test } from "../../fixtures/environments.js";
import { environmentsData } from "../../testdata/environments.js";
import { CONDA_ENVIRONMENTS_SECTION } from "../../testdata/settings.js";

/**
 * The Create environment popup's UI against the real conda bridge: the location
 * comes from `conda.info` and Create is gated by main's prefix check, which reads
 * the sandbox's filesystem. No environment is created, so the junk name the
 * spec accepts stays free.
 */
test.describe("Conda Environments create popup", () => {
	test.beforeEach(async ({ appShellPage, settingsPage, environmentsPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await settingsPage.verifySectionListed(
			CONDA_ENVIRONMENTS_SECTION,
			environmentsData.flagMissingMessage,
		);
		await settingsPage.openSection(CONDA_ENVIRONMENTS_SECTION);
		await environmentsPage.waitForEnvironmentsLoaded();
		await settingsPage.verifySectionOpened(CONDA_ENVIRONMENTS_SECTION);
	});

	test.afterEach(async ({ environmentsPage, settingsPage }) => {
		await environmentsPage.dismissCreateDialogIfOpen();
		await settingsPage.returnToAppIfOpen();
	});

	test("opens with a location filled from conda", async ({ environmentsPage }) => {
		await environmentsPage.openCreateDialog();
		await environmentsPage.verifyCreateDialogScaffold();
	});

	test("lists the sandbox directory in the location picker", async ({ environmentsPage }) => {
		await environmentsPage.openCreateDialog();
		await environmentsPage.verifySandboxLocationIsOffered();
	});

	test("shows the name rule before asking the bridge", async ({ environmentsPage }) => {
		await environmentsPage.openCreateDialog();
		await environmentsPage.verifyCreateNameRejected(environmentsData.createDialog.invalidName);
	});

	test("explains that the seeded environment already uses the name", async ({
		environmentsPage,
	}) => {
		await environmentsPage.openCreateDialog();
		await environmentsPage.verifySeededNameIsRejected();
	});

	test("refuses conda's reserved environment names", async ({ environmentsPage }) => {
		await environmentsPage.openCreateDialog();
		await environmentsPage.verifyReservedNameIsRejected();
	});

	test("enables Create once a free name checks out", async ({ environmentsPage }) => {
		await environmentsPage.openCreateDialog();
		await environmentsPage.verifyFreeNameIsCreatable();
	});

	test("closes without creating when Cancel is clicked", async ({ environmentsPage }) => {
		await environmentsPage.openCreateDialog();
		await environmentsPage.cancelCreateDialog();
	});
});
