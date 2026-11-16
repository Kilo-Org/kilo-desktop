import { DiagnosticsPage } from "../pages/developer/diagnostics-page.js";
import { test as shellTest } from "./shell.js";

/** kilo.developer's Diagnostics, in the shared app (the e2e build forces the `developer` flag on). */
export const test = shellTest.extend<{ diagnosticsPage: DiagnosticsPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	diagnosticsPage: async ({}, use) => {
		await use(new DiagnosticsPage());
	},
});

export const { expect } = test;
