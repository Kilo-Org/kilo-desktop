import { ExternalAiAppsPage } from "../../pages/shell/external-ai-apps-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ externalAiAppsPage: ExternalAiAppsPage }>({
	// Pairing writes to kilo.core's external-apps settings; keep them out of the shared profile.
	appIsolationKey: "external-ai-apps",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	externalAiAppsPage: async ({}, use) => {
		await use(new ExternalAiAppsPage());
	},
});

export const { expect } = test;
