import { ThemePage } from "../../pages/features/theme/theme-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ themePage: ThemePage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	themePage: async ({}, use) => {
		await use(new ThemePage());
	},
});

export const { expect } = test;
