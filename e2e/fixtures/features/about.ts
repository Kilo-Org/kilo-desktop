import { AboutPage } from "../../pages/features/settings/about-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ aboutPage: AboutPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires destructuring.
	aboutPage: async ({}, use) => {
		await use(new AboutPage());
	},
});

// A fresh profile keeps the Kilo config row deterministic: specs sharing the default worker
// may run Kilo flows that create the global config file this page reports on.
test.use({ appIsolationKey: "about" });
