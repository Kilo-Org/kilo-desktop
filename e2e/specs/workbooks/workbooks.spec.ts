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

	test("offers the Workbook picker on the New Session page, whose New workbook opens the Coding template's Brief", async ({
		appShellPage,
		workbooksPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await workbooksPage.openNewSessionPage();
		await workbooksPage.verifyCodingTemplateOffered();
	});
});
