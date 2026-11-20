import { KeyboardShortcutsPage } from "../../pages/shell/keyboard-shortcuts-page.js";
import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The side menu driven by the shortcuts the main process captures, in an app
 * of its own. `keyboardShortcutsPage` is kilo.shell's: only it can reach
 * Electron to deliver a chord the way the OS does.
 */
export const test = sidemenuTest.extend<{ keyboardShortcutsPage: KeyboardShortcutsPage }>({
	appIsolationKey: "sidemenu-shortcuts",
	keyboardShortcutsPage: async ({ electronApp }, use) => {
		await use(new KeyboardShortcutsPage(electronApp));
	},
});

export const { expect } = test;
