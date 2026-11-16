import {
	click,
	expectElementToBeEnabled,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

export class PrivacyPage {
	private readonly toggle = () => getLocatorByTestId("privacy-data-collection");

	async open(): Promise<void> {
		await click(getLocatorByTestId("settings-section-privacy"));
		await expectElementToBeVisible(
			getLocatorByTestId("privacy-settings"),
			"Privacy settings should open from the settings navigation",
		);
		await expectElementToBeEnabled(
			this.toggle(),
			"Privacy settings should finish loading the data collection choice",
		);
	}

	async verifyOff(): Promise<void> {
		await expectElementToHaveAttribute(this.toggle(), "aria-checked", "false", {
			message: "Data collection should be off",
		});
	}

	async enable(): Promise<void> {
		await click(this.toggle());
		await this.verifyOn();
	}

	async verifyOn(): Promise<void> {
		await expectElementToHaveAttribute(this.toggle(), "aria-checked", "true", {
			message: "Data collection should be on",
		});
	}

	async disable(): Promise<void> {
		await click(this.toggle());
		await this.verifyOff();
	}
}
