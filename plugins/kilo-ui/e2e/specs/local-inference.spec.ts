import { test } from "../fixtures.js";

test.describe("Local inference @smoke", () => {
	test("shows the managed Local provider and GGUF action", async ({
		appShellPage,
		localProvidersPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await localProvidersPage.open();
		await localProvidersPage.verifyAddModelAction();
	});
});
