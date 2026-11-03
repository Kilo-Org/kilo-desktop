import { test } from "../../fixtures/shell.js";

test.describe("Shell frame @smoke @packaged", () => {
	test("keeps a full-height top bar with the sidebar docked or collapsed", async ({
		appShellPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.verifyTopBarKeepsItsHeight();
	});
});
