import { test } from "../../fixtures/shell/ai-providers.js";

test.describe("AI Providers settings", () => {
	test("opens AI Providers with the Kilo Gateway panel above the AI providers kilo.core lists @smoke", async ({
		appShellPage,
		aiProvidersPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await aiProvidersPage.openFromSettings();
		await aiProvidersPage.verifyKiloLoginOrSignedIn();
		await aiProvidersPage.verifyProvidersListed();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
