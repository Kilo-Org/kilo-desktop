import { PagesPage } from "../pages/pages/pages-page.js";
import { test as shellTest } from "./shell.js";

type PagesFixtures = {
	pagesPage: PagesPage;
};

export const test = shellTest.extend<PagesFixtures>({
	appIsolationKey: "pages",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	pagesPage: async ({}, use) => use(new PagesPage()),
});

export const { expect } = test;
