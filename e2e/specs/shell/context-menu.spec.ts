import { test } from "../../fixtures/shell/context-menu.js";

test.describe("Native context menu @smoke @packaged", () => {
	test("offers native edit actions when right-clicking a text field", async ({
		appShellPage,
		contextMenuPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await contextMenuPage.verifyTextFieldOffersEditActions();
	});
});
