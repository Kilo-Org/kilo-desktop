import { AccountPage } from "../../pages/shell/account-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ accountPage: AccountPage }>({
	// kilo.core reads the account through the Kilo server it starts; a worker of its own keeps
	// that start out of the shared app's specs. The page object waits for it to settle.
	appIsolationKey: "account",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	accountPage: async ({}, use) => {
		await use(new AccountPage());
	},
});

export const { expect } = test;
