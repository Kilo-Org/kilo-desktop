import { SettingsSearchPage } from "../../pages/features/settings/settings-search-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ settingsSearchPage: SettingsSearchPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires destructuring.
	settingsSearchPage: async ({}, use) => {
		await use(new SettingsSearchPage());
	},
});
