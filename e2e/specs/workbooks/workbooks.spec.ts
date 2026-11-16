import { test } from "../../fixtures/workbooks.js";

test.describe("Workbooks @smoke", () => {
	test("runs kilo.workbooks with its workbooks flag on in the e2e build", async ({
		appShellPage,
		diagnosticsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await diagnosticsPage.open();
		await diagnosticsPage.verifyPluginActive("kilo.workbooks");
		await diagnosticsPage.openFlags();
		await diagnosticsPage.verifyFlagOrigin("workbooks", "override");
	});

	test("opens Start from a workbook from the session list, offering the Coding template", async ({
		appShellPage,
		workbooksPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await workbooksPage.openStartDialog();
		await workbooksPage.verifyCodingTemplateOffered();
	});
});
