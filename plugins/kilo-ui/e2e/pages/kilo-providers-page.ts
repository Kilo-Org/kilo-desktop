import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";

/**
 * Page object for the kilo-ui Providers settings section.
 */
export class KiloProvidersPage {
	private readonly section = () => getLocatorByTestId("kilo-providers-page");
	private readonly nav = () => getLocatorByTestId("settings-section-kilo-providers");

	async openFromSettings(): Promise<void> {
		await click(this.nav());
		await this.verifyLoaded();
	}

	async verifyLoaded(): Promise<void> {
		await expectElementToBeVisible(this.section(), "Providers settings should be visible");
	}
}
