import { BrowserGuestSessionPage } from "../pages/browser/browser-guest-session-page.js";
import { BrowserPage } from "../pages/browser/browser-page.js";
import { test as shellTest } from "./shell.js";

type BrowserFixtures = {
	browserPage: BrowserPage;
	browserGuestSessionPage: BrowserGuestSessionPage;
};

export const test = shellTest.extend<BrowserFixtures>({
	appIsolationKey: "browser",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	browserPage: async ({}, use) => use(new BrowserPage()),
	browserGuestSessionPage: async ({ electronApp }, use) =>
		use(new BrowserGuestSessionPage(electronApp)),
});

export const { expect } = test;
