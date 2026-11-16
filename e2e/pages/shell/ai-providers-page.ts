import {
	click,
	getLocatorCount,
	pressPageKeyboard,
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
 * Page object for kilo.shell's Settings → AI Providers: the provider list read
 * from kilo.core's AI providers, with the Kilo Gateway panel on top.
 */
export class AiProvidersPage {
	private readonly section = () => getLocatorByTestId("kilo-providers-page");
	private readonly nav = () => getLocatorByTestId("settings-section-ai-providers");
	private readonly loading = () => getLocatorByTestId("kilo-providers-loading");
	private readonly catalogError = () => getLocatorByTestId("kilo-providers-error");
	private readonly kiloCard = () => getLocatorByTestId("kilo-providers-row-kilo");
	private readonly addProvider = () => getLocatorByTestId("kilo-providers-add-provider");
	private readonly addDialog = () => getLocatorByTestId("kilo-providers-add-dialog");
	// Catalog choices; the custom-provider entry shares the prefix.
	private readonly catalogChoices = () =>
		this.addDialog().locator(
			'[data-qa-id^="kilo-providers-add-"]:not([data-qa-id="kilo-providers-add-custom"])',
		);
	private readonly login = () => getLocatorByTestId("kilo-account-login");
	private readonly logout = () => getLocatorByTestId("kilo-account-logout");

	async openFromSettings(): Promise<void> {
		await click(this.nav());
		await this.verifyLoaded();
	}

	async verifyLoaded(): Promise<void> {
		await expectElementToBeVisible(this.section(), "AI Providers settings should be visible");
	}

	/** Wait for the provider catalog to settle, failing with the page's own error text if it errored. */
	async verifyCatalogLoaded(timeoutMs = CATALOG_SETTLED_TIMEOUT_MS): Promise<void> {
		await expectElementToBeHidden(this.loading(), {
			message: "The provider catalog should finish loading",
			timeout: timeoutMs,
		});
		if (await this.catalogError().isVisible()) {
			throw new Error(
				`The provider catalog failed to load: ${(await this.catalogError().textContent())?.trim()}`,
			);
		}
	}

	/**
	 * Asserts the Kilo Gateway row finished loading: either the signed-out
	 * Sign in button or the signed-in Sign out button (details stay expanded).
	 * Does not complete OAuth in CI.
	 */
	async verifyKiloLoginOrSignedIn(): Promise<void> {
		await this.verifyLoaded();
		await this.verifyCatalogLoaded();
		await expectElementToBeVisible(this.kiloCard(), "Kilo Gateway card should be visible");
		await getPage().waitForFunction(() => {
			if (document.querySelector('[data-qa-id="kilo-account-login"]')) return true;
			return Boolean(document.querySelector('[data-qa-id="kilo-account-logout"]'));
		});
		if (await this.login().isVisible()) {
			await expectElementToBeVisible(
				this.login(),
				"Kilo Sign in button should be visible when signed out",
			);
			return;
		}
		await expectElementToBeVisible(
			this.logout(),
			"Kilo Sign out button should be visible when signed in",
		);
	}

	/**
	 * The AI providers come from kilo.core's running Kilo server: once read,
	 * Add AI Provider lists the catalog to connect (a fresh profile has none
	 * connected). Pass a longer budget right after the server was started.
	 */
	async verifyProvidersListed(timeoutMs = CATALOG_SETTLED_TIMEOUT_MS): Promise<void> {
		await this.verifyLoaded();
		await this.verifyCatalogLoaded(timeoutMs);
		await click(this.addProvider());
		await expectElementToBeVisible(this.addDialog(), "Add AI Provider should open its dialog");
		const count = await getLocatorCount(this.catalogChoices());
		if (count === 0) throw new Error("Add AI Provider should list the AI providers to connect");
		await pressPageKeyboard("Escape");
		await expectElementToBeHidden(this.addDialog(), {
			message: "The Add AI Provider dialog should close on Escape",
		});
	}
}
