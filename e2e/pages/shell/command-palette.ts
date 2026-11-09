import type { ElectronApplication } from "@playwright/test";

import { click, getLocatorByTestId } from "@anaconda/playwright-utils";

import { KeyboardShortcutsPage } from "./keyboard-shortcuts-page.js";

/*
 * The app the current test drives, bound by the electronApp fixture (like the
 * page singleton), so module-level helpers can reach commands that have no
 * button, through the palette as a person would.
 */
let currentApp: ElectronApplication | undefined;

export function setCommandPaletteApp(app: ElectronApplication): void {
	currentApp = app;
}

export async function runFromCommandPalette(commandKey: string): Promise<void> {
	if (!currentApp) throw new Error("No app bound: use the electronApp fixture");
	await new KeyboardShortcutsPage(currentApp).openCommandPalette();
	await click(getLocatorByTestId(`command-palette-item-${commandKey}`));
}
