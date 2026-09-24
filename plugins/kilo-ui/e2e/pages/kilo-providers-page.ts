import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Longer than the catalog request's 15s product bound plus one retry, so a
 * slow catalog resolves to the page's own error state instead of the test
 * giving up while the page still shows the loading skeleton.
 */
const CATALOG_SETTLED_TIMEOUT_MS = 45_000;

/**
 * Page object for the kilo-ui AI Providers settings section and its primary
 * Kilo Gateway connection.
 */
export class KiloProvidersPage {
	private readonly section = () => getLocatorByTestId("kilo-providers-page");
	private readonly nav = () => getLocatorByTestId("settings-section-kilo-providers");
	private readonly loading = () => getLocatorByTestId("kilo-providers-loading");
	private readonly catalogError = () => getLocatorByTestId("kilo-providers-error");
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

	/** Wait for the provider catalog to settle, failing with the page's own error text if it errored. */
	async verifyCatalogLoaded(): Promise<void> {
		await expectElementToBeHidden(this.loading(), {
			message: "The provider catalog should finish loading",
			timeout: CATALOG_SETTLED_TIMEOUT_MS,
		});
		if (await this.catalogError().isVisible()) {
			throw new Error(
				`The provider catalog failed to load: ${(await this.catalogError().textContent())?.trim()}`,
			);
		}
	}

	/**
	 * Asserts the Kilo Gateway row finished loading: either the signed-out
	 * Sign In button or the signed-in details toggle.
	 * Does not complete OAuth in CI.
	 */
	async verifyKiloLoginOrSignedIn(): Promise<void> {
		await this.verifyLoaded();
		await this.verifyCatalogLoaded();
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
