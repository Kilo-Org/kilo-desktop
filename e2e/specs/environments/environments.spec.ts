import { test } from "../../fixtures/developer.js";

// The Conda Environments settings page is behind the LaunchDarkly
// `environments-feature` flag, which package:e2e does not force on, so this
// smoke proves what does not depend on it: the plugin activates and registers
// its conda bridge (started on first use).
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
