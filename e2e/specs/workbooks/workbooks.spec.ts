import { test } from "../../fixtures/developer.js";

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
});
