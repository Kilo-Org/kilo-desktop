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

	private readonly cheatSheet = () => getLocatorByTestId("keyboard-shortcuts-dialog");

	/** Press the primary modifier (⌘ on macOS, Ctrl elsewhere) plus an Electron key code. */
	async pressAppShortcut(keyCode: string): Promise<void> {
		await this.electronApp.evaluate(({ BrowserWindow }, key) => {
			const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
			if (!window) throw new Error("No app window to send the shortcut to");
			const modifiers: Array<"meta" | "control"> = [
				process.platform === "darwin" ? "meta" : "control",
			];
			window.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
			window.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
		}, keyCode);
	}

	async openCheatSheet(): Promise<void> {
		await this.pressAppShortcut("/");
	}

	async verifyCheatSheetLists(commandId: string): Promise<void> {
		await expectElementToBeVisible(
			this.cheatSheet(),
			"Mod+/ should open the keyboard shortcut list through the main-process capture",
		);
		await expectElementToBeVisible(
			getLocatorByTestId(`keyboard-shortcut-${commandId}`),
			`The shortcut list should include ${commandId}`,
		);
	}

	async closeCheatSheet(): Promise<void> {
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
