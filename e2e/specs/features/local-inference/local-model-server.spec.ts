import { test } from "../../../fixtures/features/local-inference.js";

test.describe("Local Model Server @smoke", () => {
	test("opens Local Model Server settings and offers the model sources", async ({
		appShellPage,
		localModelServerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await localModelServerPage.open();
		await localModelServerPage.verifyAddModelSources();
	});
});
