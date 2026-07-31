import { AppShellPage } from "../pages/shell/app-shell.js";

import { electronFixture } from "./electron.js";

/**
 * Shell-owned fixtures only. Feature page objects live in per-feature fixtures
 * that extend this base (same pattern plugins use).
 */
export const test = electronFixture.extend<{ appShellPage: AppShellPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	appShellPage: async ({}, use) => {
		await use(new AppShellPage());
	},
});

export const { expect } = test;
