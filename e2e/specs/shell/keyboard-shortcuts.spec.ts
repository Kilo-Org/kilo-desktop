import { test } from "../../fixtures/shell/keyboard-shortcuts.js";
import { runFromCommandPalette } from "../../pages/shell/command-palette.js";

test.describe("Keyboard shortcuts @smoke", () => {
	test("dispatches app shortcuts captured in the main process", async ({
		appShellPage,
		keyboardShortcutsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();

		await keyboardShortcutsPage.openCheatSheet();
		await keyboardShortcutsPage.verifyCheatSheetLists("kilo.shell/open-settings");
		// kilo.work-sessions' App Navigation panel draws the tab numbers as one row.
		await keyboardShortcutsPage.verifyCheatSheetLists("kilo.work-sessions/pane-1");
		await keyboardShortcutsPage.closeCheatSheet();

		await keyboardShortcutsPage.openCommandPalette();
		await keyboardShortcutsPage.verifyPaletteLists("kilo.shell/go-home");
		await keyboardShortcutsPage.closeCommandPalette();

		await keyboardShortcutsPage.openSettingsWithShortcut();
		await keyboardShortcutsPage.verifySettingsOpen();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});

	test("runs a command chosen in the command palette", async ({
		appShellPage,
		keyboardShortcutsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await runFromCommandPalette("kilo.shell/open-settings");
		await keyboardShortcutsPage.verifySettingsOpen();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
