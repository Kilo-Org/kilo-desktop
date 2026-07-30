import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";

export class SdkConsumerPage {
	private readonly heading = () => getLocatorByTestId("sdk-consumer-heading");
	private readonly peekButton = () => getLocatorByTestId("sdk-consumer-peek");
	private readonly capabilityButton = () => getLocatorByTestId("sdk-consumer-capability");

	async verifyPageIsLoaded(): Promise<void> {
		await expectElementToBeVisible(this.heading(), "SDK Consumer heading should be visible");
	}

	async peekProducerState(): Promise<void> {
		await click(this.peekButton());
	}

	async callProducerCapability(): Promise<void> {
		await click(this.capabilityButton());
	}
}
