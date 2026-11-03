import { test } from "../../fixtures/features/keyboard-shortcuts.js";

test.describe("Keyboard shortcuts @smoke", () => {
	test("dispatches app shortcuts captured in the main process", async ({
		appShellPage,
		keyboardShortcutsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();

		await keyboardShortcutsPage.openCheatSheet();
		await keyboardShortcutsPage.verifyCheatSheetLists("kilo.shell/open-settings");
		await keyboardShortcutsPage.closeCheatSheet();

		await keyboardShortcutsPage.openCommandPalette();
		await keyboardShortcutsPage.verifyPaletteLists("kilo.shell/go-home");
		await keyboardShortcutsPage.closeCommandPalette();

		await keyboardShortcutsPage.openSettingsWithShortcut();
		await keyboardShortcutsPage.verifySettingsOpen();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
