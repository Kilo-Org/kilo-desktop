import { test } from "../../fixtures/shell/app-menu.js";

test.describe("Native app menu @smoke @packaged", () => {
	test("offers shell's commands and runs the one chosen", async ({ appShellPage, appMenuPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appMenuPage.verifyMenuOffers("Show all commands");
		await appMenuPage.openSettingsFromMenu();
		await appShellPage.leaveSettings();
	});
});
