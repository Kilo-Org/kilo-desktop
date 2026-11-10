import { test } from "../../fixtures/shell/external-ai-apps.js";

test.describe("External AI apps @packaged", () => {
	test("pairs an external app, serves it Desktop tools, and revokes it @smoke", async ({
		appShellPage,
		externalAiAppsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await externalAiAppsPage.open();
		await externalAiAppsPage.useFreePort();
		await externalAiAppsPage.enable();
		await externalAiAppsPage.pairApp("e2e app");

		await externalAiAppsPage.verifyPairedAppCanUseDesktopTools();

		await externalAiAppsPage.removeApp("e2e app");
		await externalAiAppsPage.verifyRemovedAppIsRefused();
		await externalAiAppsPage.disable();
		await externalAiAppsPage.verifyEndpointIsClosed();
	});
});
