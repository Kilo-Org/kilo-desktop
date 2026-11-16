import { test } from "../../fixtures/chat.js";

test.describe("Desktop agent tools @packaged", () => {
	test("serves kilo.chat's tools to Kilo through kilo.core's gateway @smoke", async ({
		appShellPage,
		desktopToolsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await desktopToolsPage.verifyKiloConnectedToDesktopTools();
		await desktopToolsPage.verifyDesktopToolCallReachesTheApp();
	});
});
