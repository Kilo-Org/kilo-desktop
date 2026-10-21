import { test as shellTest } from "@kilo-desktop/e2e/fixtures";

import { AnacondaAccountPage } from "./pages/anaconda-account-page.js";

/**
 * Plugin-local e2e fixture (Playwright globs plugins/*\/e2e/specs/**\/*.spec.ts
 * from the repo-root config, so no central registry edit is needed).
 */
export const test = shellTest.extend<{ anacondaAccountPage: AnacondaAccountPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	anacondaAccountPage: async ({}, use) => {
		await use(new AnacondaAccountPage());
	},
});

test.use({ appIsolationKey: "anaconda-account" });

export const { expect } = test;
