import { test } from "../fixtures.js";

test.use({ appIsolationKey: "local-inference" });

test.describe("Local inference", () => {
	test("opens Local Model Server settings", async ({ appShellPage, localProvidersPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await localProvidersPage.open();
		await localProvidersPage.verifyAddModelAction();
	});
});
