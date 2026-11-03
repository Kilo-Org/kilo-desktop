import { test } from "../../../fixtures/features/agent.js";

test.use({ appIsolationKey: "agent-providers" });

test.describe("AI Providers settings", () => {
	test("opens AI Providers and shows the Kilo Gateway account card @smoke", async ({
		appShellPage,
		aiProvidersPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await aiProvidersPage.openFromSettings();
		await aiProvidersPage.verifyKiloLoginOrSignedIn();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
