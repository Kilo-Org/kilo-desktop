import { test } from "../../../fixtures/features/sdk-consumer.js";

test.describe("SDK Consumer @smoke", () => {
	test("loads the consumer view that reads from sdk-producer", async ({
		appShellPage,
		sdkConsumerPage,
	}) => {
		await appShellPage.navigateToFeature("sdk-consumer");
		await sdkConsumerPage.verifyPageIsLoaded();
	});
});
