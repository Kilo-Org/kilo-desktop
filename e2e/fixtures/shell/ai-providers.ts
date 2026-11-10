import { AiProvidersPage } from "../../pages/shell/ai-providers-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ aiProvidersPage: AiProvidersPage }>({
	// The provider list starts kilo.core's Kilo server work; keep it out of the shared app.
	appIsolationKey: "ai-providers",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	aiProvidersPage: async ({}, use) => {
		await use(new AiProvidersPage());
	},
});

export const { expect } = test;
