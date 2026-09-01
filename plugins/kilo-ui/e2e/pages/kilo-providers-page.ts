import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Page object for the kilo-ui AI Providers settings section and its primary
 * Kilo Gateway connection.
 */
export class KiloProvidersPage {
	private readonly section = () => getLocatorByTestId("kilo-providers-page");
	private readonly nav = () => getLocatorByTestId("settings-section-kilo-providers");
	private readonly kiloCard = () => getLocatorByTestId("kilo-providers-row-kilo");
	private readonly login = () => getLocatorByTestId("kilo-account-login");
	private readonly logout = () => getLocatorByTestId("kilo-account-logout");
	private readonly toggle = () => getLocatorByTestId("kilo-provider-toggle");

	async openFromSettings(): Promise<void> {
		await click(this.nav());
		await this.verifyLoaded();
	}

	async verifyLoaded(): Promise<void> {
		await expectElementToBeVisible(this.section(), "AI Providers settings should be visible");
	}

	/**
	 * Asserts the Kilo Gateway row finished loading: either the signed-out
	 * Sign In button or the signed-in details toggle.
	 * Does not complete OAuth in CI.
	 */
	async verifyKiloLoginOrSignedIn(): Promise<void> {
		await this.verifyLoaded();
		await expectElementToBeVisible(this.kiloCard(), "Kilo Gateway card should be visible");
		await getPage().waitForFunction(() => {
			if (document.querySelector('[data-qa-id="kilo-account-login"]')) return true;
			return Boolean(document.querySelector('[data-qa-id="kilo-provider-toggle"]'));
		});
		if (await this.login().isVisible()) {
			await expectElementToBeVisible(
				this.login(),
				"Kilo Sign In button should be visible when signed out",
			);
			return;
		}
		await click(this.toggle());
		await expectElementToBeVisible(
			this.logout(),
			"Kilo Sign Out button should be visible in expanded account details",
		);
	}
}
