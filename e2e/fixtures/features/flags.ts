import { DiagnosticsPage } from "../../pages/features/developer/diagnostics-page.js";
import { FlagGatedSettingsPage } from "../../pages/features/flags/flag-gated-settings-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{
	diagnosticsPage: DiagnosticsPage;
	flagGatedSettingsPage: FlagGatedSettingsPage;
}>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	diagnosticsPage: async ({}, use) => {
		await use(new DiagnosticsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	flagGatedSettingsPage: async ({}, use) => {
		await use(new FlagGatedSettingsPage());
	},
});

export const { expect } = test;
