import { click, fill, getLocatorByTestId } from "@anaconda/playwright-utils";
import { expect } from "@playwright/test";
import type { ElectronApplication } from "playwright";

type CapturedMenus = { __kiloE2eContextMenus?: string[][] };

/**
 * Native menus render outside the DOM, so this page object swaps
 * `Menu.prototype.popup` in the main process for a recorder. That still
 * exercises Chromium's real right-click → `context-menu` path while keeping
 * a modal OS menu from blocking the test.
 */
export class ContextMenuPage {
	private readonly settingsSearch = () => getLocatorByTestId("settings-search");

	constructor(private readonly app: ElectronApplication) {}

	async verifyTextFieldOffersEditActions(): Promise<void> {
		await this.captureNativeMenus();
		try {
			await fill(this.settingsSearch(), "theme");
			await click(this.settingsSearch(), { button: "right" });
			await expect
				.poll(() => this.lastCapturedMenu(), {
					message: "Right-clicking a text field should open the native edit menu",
				})
				.toEqual(expect.arrayContaining(["undo", "cut", "copy", "paste"]));
		} finally {
			await this.restoreNativeMenus();
		}
	}

	private async captureNativeMenus(): Promise<void> {
		await this.app.evaluate(({ Menu }) => {
			const scope = globalThis as typeof globalThis & {
				__kiloE2eOriginalPopup?: typeof Menu.prototype.popup;
			} & CapturedMenus;
			scope.__kiloE2eOriginalPopup ??= Menu.prototype.popup;
			scope.__kiloE2eContextMenus = [];
			Menu.prototype.popup = function (this: Electron.Menu) {
				scope.__kiloE2eContextMenus?.push(
					this.items.map((item) => item.role?.toLowerCase() ?? item.label),
				);
			};
		});
	}

	private async restoreNativeMenus(): Promise<void> {
		await this.app.evaluate(({ Menu }) => {
			const scope = globalThis as typeof globalThis & {
				__kiloE2eOriginalPopup?: typeof Menu.prototype.popup;
			} & CapturedMenus;
			if (scope.__kiloE2eOriginalPopup) Menu.prototype.popup = scope.__kiloE2eOriginalPopup;
			delete scope.__kiloE2eOriginalPopup;
			delete scope.__kiloE2eContextMenus;
		});
	}

	private lastCapturedMenu(): Promise<string[] | undefined> {
		return this.app.evaluate(() => (globalThis as CapturedMenus).__kiloE2eContextMenus?.at(-1));
	}
}
