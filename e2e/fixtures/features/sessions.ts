import { LayoutPresetsPage } from "../../pages/features/sessions/layout-presets-page.js";
import { SessionListPage } from "../../pages/features/sessions/session-list-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{
	sessionListPage: SessionListPage;
	layoutPresetsPage: LayoutPresetsPage;
}>({
	appIsolationKey: "sessions",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	sessionListPage: async ({}, use) => {
		await use(new SessionListPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	layoutPresetsPage: async ({}, use) => {
		await use(new LayoutPresetsPage());
	},
});

export const { expect } = test;
