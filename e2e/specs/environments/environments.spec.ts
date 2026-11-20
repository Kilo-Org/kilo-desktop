import { test } from "../../fixtures/developer.js";

// The plugin activates and registers its conda bridge (started on first use);
// the settings page itself is covered by environments-settings.spec.ts.
test.describe("Conda environments @smoke", () => {
	test("activates and registers the conda bridge service", async ({
		appShellPage,
		diagnosticsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await diagnosticsPage.open();
		await diagnosticsPage.verifyPluginActive("kilo.environments");
		await diagnosticsPage.openServices();
		await diagnosticsPage.verifyServiceListed("kilo.environments/bridge");
	});
});
