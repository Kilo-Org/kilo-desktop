import { test } from "../../fixtures/work-sessions/sidemenu-shortcuts.js";

/**
 * The side menu's own keyboard shortcut, delivered the way the OS delivers it.
 *
 * Only the packaged app can show this: the chord is captured in the main
 * process (`before-input-event`), dispatched to the window's
 * `search-work-sessions` command, and the side menu's search dialog opens from
 * window-local state. The component tier runs that command directly, so
 * nothing below e2e covers the chord reaching it. kilo.shell's keyboard
 * shortcuts spec covers the capture itself, for its own commands.
 *
 * The command toggles the dialog, but the chord cannot close it: the host runs
 * no shortcut behind an open dialog (`dispatchUnlessModal`, covered by
 * `apps/web`'s `boot.app.test.tsx`), so Escape is the way out.
 */
test.describe("Side menu keyboard shortcut @packaged", () => {
	test("opens the session search with its shortcut", async ({
		sidemenuPage,
		keyboardShortcutsPage,
	}) => {
		await sidemenuPage.verifySessionListVisible();

		await sidemenuPage.openSearchWithShortcut(keyboardShortcutsPage);

		await sidemenuPage.closeWithEscape();
		await sidemenuPage.verifySearchDialogClosed();
	});
});
