import { expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { expect } from "@playwright/test";
import type { ElectronApplication } from "playwright";

/**
 * The native application menu renders outside the DOM, so this page object
 * reads it from the main process (`Menu.getApplicationMenu()`) and clicks its
 * items there, as the OS would.
 */
export class AppMenuPage {
	constructor(private readonly app: ElectronApplication) {}

	async verifyMenuOffers(label: string): Promise<void> {
		await expect
			.poll(() => this.labels(), {
				message: `The app menu should offer "${label}" once the window sets its menu`,
			})
			.toContain(label);
	}

	async openSettingsFromMenu(): Promise<void> {
		await this.verifyMenuOffers("Settings…");
		await this.app.evaluate(({ Menu }) => {
			const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
				for (const item of items) {
					if (item.label === "Settings…") return item;
					const nested = item.submenu && find(item.submenu.items);
					if (nested) return nested;
				}
				return undefined;
			};
			const settings = find(Menu.getApplicationMenu()?.items ?? []);
			settings?.click();
		});
		await expectElementToBeVisible(
			getLocatorByTestId("settings-back"),
			"Choosing Settings… in the app menu should open Settings",
		);
	}

	private labels(): Promise<string[]> {
		return this.app.evaluate(({ Menu }) => {
			const collect = (items: Electron.MenuItem[]): string[] =>
				items.flatMap((item) => [item.label, ...(item.submenu ? collect(item.submenu.items) : [])]);
			return collect(Menu.getApplicationMenu()?.items ?? []);
		});
	}
}
