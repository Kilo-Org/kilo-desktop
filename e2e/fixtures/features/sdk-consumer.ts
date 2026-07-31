import { SdkConsumerPage } from "../../pages/features/sdk-consumer/sdk-consumer-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ sdkConsumerPage: SdkConsumerPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	sdkConsumerPage: async ({}, use) => {
		await use(new SdkConsumerPage());
	},
});

export const { expect } = test;
