import { test } from "../fixtures.js";

test.describe("Local inference @smoke", () => {
	test("opens Local Model Server settings", async ({ appShellPage, localProvidersPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await localProvidersPage.open();
		await localProvidersPage.verifyAddModelAction();
	});
});
