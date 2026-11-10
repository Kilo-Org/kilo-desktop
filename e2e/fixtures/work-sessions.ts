import { LayoutPresetsPage } from "../pages/work-sessions/layout-presets-page.js";
import { NewWorkSessionPage } from "../pages/work-sessions/new-work-session-page.js";
import { SessionListPage } from "../pages/work-sessions/session-list-page.js";
import { test as shellTest } from "./shell.js";

/**
 * kilo.work-sessions' session list, New Session page and layouts, in an app
 * of their own: the specs create, rename and delete sessions by title.
 */
export const test = shellTest.extend<{
	sessionListPage: SessionListPage;
	newWorkSessionPage: NewWorkSessionPage;
	layoutPresetsPage: LayoutPresetsPage;
}>({
	appIsolationKey: "work-sessions",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	sessionListPage: async ({}, use) => {
		await use(new SessionListPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	newWorkSessionPage: async ({}, use) => {
		await use(new NewWorkSessionPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	layoutPresetsPage: async ({}, use) => {
		await use(new LayoutPresetsPage());
	},
});

export const { expect } = test;
