import { DiagnosticsPage } from "../../pages/features/developer/diagnostics-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ diagnosticsPage: DiagnosticsPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires destructuring.
	diagnosticsPage: async ({}, use) => {
		await use(new DiagnosticsPage());
	},
});
