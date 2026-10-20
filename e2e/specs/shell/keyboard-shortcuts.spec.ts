import { test } from "../../fixtures/features/keyboard-shortcuts.js";

test.describe("Keyboard shortcuts @smoke", () => {
	test("dispatches app shortcuts captured in the main process", async ({
		appShellPage,
		keyboardShortcutsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();

		await keyboardShortcutsPage.openCheatSheet();
		await keyboardShortcutsPage.verifyCheatSheetLists("kilo-ui.search");
		await keyboardShortcutsPage.closeCheatSheet();

		await keyboardShortcutsPage.openSettingsWithShortcut();
		await keyboardShortcutsPage.verifySettingsOpen();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
