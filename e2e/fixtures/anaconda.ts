import { AnacondaAccountPage } from "../pages/anaconda/anaconda-account-page.js";
import { test as shellTest } from "./shell.js";

export const test = shellTest.extend<{ anacondaAccountPage: AnacondaAccountPage }>({
	appIsolationKey: "anaconda-account",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	anacondaAccountPage: async ({}, use) => {
		await use(new AnacondaAccountPage());
	},
});

export const { expect } = test;
