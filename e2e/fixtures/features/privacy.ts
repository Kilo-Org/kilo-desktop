import { PrivacyPage } from "../../pages/features/privacy/privacy-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ privacyPage: PrivacyPage }>({
	appIsolationKey: "privacy",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires destructuring.
	privacyPage: async ({}, use) => {
		await use(new PrivacyPage());
	},
});
