import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BrowserGuestSessionPage } from "../../pages/features/browser/browser-guest-session-page.js";
import { BrowserPage } from "../../pages/features/browser/browser-page.js";
import { removePathAfterAppStops, test as shellTest } from "../shell.js";

type BrowserFixtures = {
	browserPage: BrowserPage;
	browserGuestSessionPage: BrowserGuestSessionPage;
	browserWorkspace: { path: string; name: string };
};

export const test = shellTest.extend<BrowserFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	browserPage: async ({}, use) => use(new BrowserPage()),
	browserGuestSessionPage: async ({ electronApp }, use) =>
		use(new BrowserGuestSessionPage(electronApp)),
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	browserWorkspace: async ({}, use) => {
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-workspace-"));
		removePathAfterAppStops(workspacePath);
		await use({ path: workspacePath, name: path.basename(workspacePath) });
	},
});

test.use({ appIsolationKey: "browser" });

export const { expect } = test;
