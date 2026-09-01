import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";

export class LocalProvidersPage {
	async open(): Promise<void> {
		await click(getLocatorByTestId("settings-section-kilo-providers"));
		await expectElementToBeVisible(
			getLocatorByTestId("kilo-providers-page"),
			"AI Providers settings should be visible",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("local-provider-card"),
			"Local provider card should be visible in AI Providers settings",
		);
	}

	async verifyAddModelAction(): Promise<void> {
		await click(getLocatorByTestId("local-provider-summary"));
		await expectElementToBeVisible(
			getLocatorByTestId("local-provider-dropzone"),
			"Local provider should offer a GGUF drop zone",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("local-provider-empty"),
			"Local provider should offer a GGUF add action when no models are registered",
		);
	}
}
