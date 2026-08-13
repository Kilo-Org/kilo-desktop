import { expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Page object for the kilo-ui Kilo Gateway account settings section.
 */
export class KiloAccountPage {
	private readonly section = () => getLocatorByTestId("kilo-account-settings");
	private readonly nav = () => getLocatorByTestId("settings-section-kilo-account");
	private readonly login = () => getLocatorByTestId("kilo-account-login");
	private readonly logout = () => getLocatorByTestId("kilo-account-logout");

	async openFromSettings(): Promise<void> {
		await this.nav().click();
		await this.verifyLoaded();
	}

	async verifyLoaded(): Promise<void> {
		await expectElementToBeVisible(this.section(), "Kilo account settings should be visible");
	}

	/**
	 * Asserts the account panel finished loading: either the signed-out login
	 * button or the signed-in logout control. Does not complete OAuth in CI.
	 */
	async verifyLoginOrSignedIn(): Promise<void> {
		await this.verifyLoaded();
		await getPage().waitForFunction(() => {
			const root = document.querySelector('[data-qa-id="kilo-account-settings"]');
			if (!root) return false;
			const state = root.getAttribute("data-state");
			return state === "signed-out" || state === "signed-in";
		});
		const state = await this.section().getAttribute("data-state");
		if (state === "signed-out") {
			await expectElementToBeVisible(
				this.login(),
				"Kilo login button should be visible when signed out",
			);
			return;
		}
		await expectElementToBeVisible(
			this.logout(),
			"Kilo logout button should be visible when signed in",
		);
	}
}
