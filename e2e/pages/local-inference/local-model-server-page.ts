import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	getLocatorByTestId,
	pressPageKeyboard,
} from "@anaconda/playwright-utils";

/**
 * Settings → Local Model Server (kilo.local-inference). The section sits
 * behind Kilo sign-in; the e2e build reports a signed-in account once the
 * Kilo server is up, so the settled page is the server page itself.
 */
export class LocalModelServerPage {
	private readonly sectionEntry = () => getLocatorByTestId("settings-section-local-model-server");
	private readonly page = () => getLocatorByTestId("local-model-server-page");
	private readonly addModel = () => getLocatorByTestId("local-model-server-add-model");

	async open(): Promise<void> {
		await click(this.sectionEntry());
		await expectElementToBeVisible(
			this.page(),
			"Local Model Server settings should open once Kilo sign-in resolves",
		);
		await expectElementToBeHidden(getLocatorByTestId("local-model-server-page-loading"), {
			message: "Local Model Server settings should finish loading the server status",
		});
	}

	/** Add model offers the catalog (on in e2e builds through `local-model-catalog`) and a GGUF import. */
	async verifyAddModelSources(): Promise<void> {
		await click(this.addModel());
		await expectElementToBeVisible(
			getLocatorByTestId("local-model-server-open-catalog"),
			"Add model should offer the model catalog",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("local-model-server-import-gguf"),
			"Add model should offer importing a GGUF file",
		);
		await pressPageKeyboard("Escape");
	}
}
