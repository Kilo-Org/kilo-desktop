import type { ElectronApplication } from "@playwright/test";

import {
	expectElementToBeVisible,
	getLocatorByTestId,
	pressPageKeyboard,
} from "@anaconda/playwright-utils";

/**
 * Drives app shortcuts the way the OS delivers them. Playwright's
 * `keyboard.press` injects keys over CDP, which skips Electron's
 * `before-input-event` — the main-process hook the shortcut capture relies
 * on — so key presses go through `webContents.sendInputEvent` instead.
 */
export class KeyboardShortcutsPage {
	constructor(private readonly electronApp: ElectronApplication) {}

	private readonly palette = () => getLocatorByTestId("command-palette");
	private readonly cheatSheet = () => getLocatorByTestId("keyboard-shortcuts-dialog");

	/** Press the primary modifier (⌘ on macOS, Ctrl elsewhere), optionally with Shift, plus an Electron key code. */
	async pressAppShortcut(keyCode: string, options: { shift?: boolean } = {}): Promise<void> {
		await this.electronApp.evaluate(
			({ BrowserWindow }, { key, shift }) => {
				const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
				if (!window) throw new Error("No app window to send the shortcut to");
				const modifiers: Array<"meta" | "control" | "shift"> = [
					process.platform === "darwin" ? "meta" : "control",
					...(shift ? (["shift"] as const) : []),
				];
				window.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
				window.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
			},
			{ key: keyCode, shift: options.shift ?? false },
		);
	}

	async openCheatSheet(): Promise<void> {
		await this.pressAppShortcut("/");
	}

	async verifyCheatSheetLists(commandKey: string): Promise<void> {
		await expectElementToBeVisible(
			this.cheatSheet(),
			"Mod+/ should open the keyboard shortcut list through the main-process capture",
		);
		await expectElementToBeVisible(
			getLocatorByTestId(`keyboard-shortcut-${commandKey}`),
			`The shortcut list should include ${commandKey}`,
		);
	}

	async closeCheatSheet(): Promise<void> {
		await pressPageKeyboard("Escape");
	}

	async openCommandPalette(): Promise<void> {
		await this.pressAppShortcut("P", { shift: true });
	}

	async verifyPaletteLists(commandKey: string): Promise<void> {
		await expectElementToBeVisible(
			this.palette(),
			"Mod+Shift+P should open the command palette through the main-process capture",
		);
		await expectElementToBeVisible(
			getLocatorByTestId(`command-palette-item-${commandKey}`),
			`The command palette should list ${commandKey}`,
		);
	}

	async closeCommandPalette(): Promise<void> {
		await pressPageKeyboard("Escape");
	}

	async openSettingsWithShortcut(): Promise<void> {
		await this.pressAppShortcut(",");
	}

	async verifySettingsOpen(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("settings-back"),
			"Mod+, should open Settings",
		);
	}
}
