import { AccountPage } from "../../pages/features/settings/account-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ accountPage: AccountPage }>({
	// The Account page reads sign-in status from the Kilo CLI; this key's worker waits for the
	// Kilo server before the first test.
	appIsolationKey: "kilo-ui",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	accountPage: async ({}, use) => {
		await use(new AccountPage());
	},
});

export const { expect } = test;
