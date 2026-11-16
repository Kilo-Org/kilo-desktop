import { AppShellPage } from "../pages/shell/app-shell.js";

import { electronFixture } from "./electron.js";

export { removePathAfterAppStops } from "./electron.js";

/**
 * kilo.shell's frame: the packaged app plus `appShellPage`. Feature page
 * objects live in per-feature fixtures that extend this base
 * (`fixtures/shell/<feature>.ts`, and `plugins/<id>/e2e/fixtures.ts`).
 */
export const test = electronFixture.extend<{ appShellPage: AppShellPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	appShellPage: async ({}, use) => {
		await use(new AppShellPage());
	},
});

export const { expect } = test;
