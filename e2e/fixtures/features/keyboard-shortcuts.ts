import { KeyboardShortcutsPage } from "../../pages/shell/keyboard-shortcuts-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ keyboardShortcutsPage: KeyboardShortcutsPage }>({
	keyboardShortcutsPage: async ({ electronApp }, use) => {
		await use(new KeyboardShortcutsPage(electronApp));
	},
});

export const { expect } = test;
