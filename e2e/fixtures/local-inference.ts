import { LocalModelServerPage } from "../pages/local-inference/local-model-server-page.js";
import { test as shellTest } from "./shell.js";

export const test = shellTest.extend<{ localModelServerPage: LocalModelServerPage }>({
	// The section is sign-in gated: the settings worker waits for kilo.core to read the e2e account.
	appIsolationKey: "settings",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	localModelServerPage: async ({}, use) => {
		await use(new LocalModelServerPage());
	},
});

export const { expect } = test;
