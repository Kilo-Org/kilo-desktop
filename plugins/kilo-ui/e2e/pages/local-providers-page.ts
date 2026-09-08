import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";

export class LocalProvidersPage {
	async open(): Promise<void> {
		await click(getLocatorByTestId("settings-section-local-model-server"));
		await expectElementToBeVisible(
			getLocatorByTestId("local-model-server-page"),
			"Local Model Server settings should be visible",
		);
	}

	async verifyAddModelAction(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("local-model-server-add-model"),
			"Local Model Server should offer an add model action",
		);
	}
}
