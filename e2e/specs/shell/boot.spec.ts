import { test } from "../../fixtures/shell.js";

test.describe("Shell boot @smoke @packaged", () => {
	test("loads the renderer over the custom protocol with an isolated preload", async ({
		appShellPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.verifyCustomProtocolBoot();
		await appShellPage.verifyOnboardingHidden();
	});
});
