import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Page object for the kilo-ui Providers settings section, including the
 * expandable Kilo Gateway account card.
 */
export class KiloProvidersPage {
	private readonly section = () => getLocatorByTestId("kilo-providers-page");
	private readonly nav = () => getLocatorByTestId("settings-section-kilo-providers");
	private readonly kiloCard = () => getLocatorByTestId("kilo-providers-row-kilo");
	private readonly login = () => getLocatorByTestId("kilo-account-login");
	private readonly logout = () => getLocatorByTestId("kilo-account-logout");

	async openFromSettings(): Promise<void> {
		await click(this.nav());
		await this.verifyLoaded();
	}

	async verifyLoaded(): Promise<void> {
		await expectElementToBeVisible(this.section(), "Providers settings should be visible");
	}

	/**
	 * Asserts the Kilo Gateway card finished loading: either the signed-out
	 * Connect button (collapsed header) or the signed-in Disconnect control.
	 * Does not complete OAuth in CI.
	 */
	async verifyKiloLoginOrSignedIn(): Promise<void> {
		await this.verifyLoaded();
		await expectElementToBeVisible(this.kiloCard(), "Kilo Gateway card should be visible");
		await getPage().waitForFunction(() => {
			if (document.querySelector('[data-qa-id="kilo-account-login"]')) return true;
			return Boolean(document.querySelector('[data-qa-id="kilo-account-logout"]'));
		});
		if (await this.login().isVisible()) {
			await expectElementToBeVisible(
				this.login(),
				"Kilo Connect button should be visible when signed out",
			);
			return;
		}
		await expectElementToBeVisible(
			this.logout(),
			"Kilo Disconnect button should be visible in the card header when signed in",
		);
	}
}
