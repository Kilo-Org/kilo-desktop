import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorkspaceWatcherPage } from "../../pages/features/workspace/workspace-watcher-page.js";
import { removePathAfterAppStops, test as shellTest } from "../shell.js";

type WorkspaceFixtures = {
	watcherPage: WorkspaceWatcherPage;
	watchedFolder: { path: string; name: string };
};

export const test = shellTest.extend<WorkspaceFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	watcherPage: async ({}, use) => {
		await use(new WorkspaceWatcherPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	watchedFolder: async ({}, use) => {
		// A real folder the packaged app's native watcher can subscribe to.
		// Resolve to the canonical path first — kilo-ui registers folders by
		// their realpath, and the watcher reports event paths under the
		// registered root (macOS temp dirs are /var → /private/var symlinks).
		// Removal is deferred until the app stops (Windows holds open handles).
		const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-workspace-watch-"));
		const folderPath = await realpath(rawPath);
		removePathAfterAppStops(rawPath);
		removePathAfterAppStops(folderPath);
		await use({ path: folderPath, name: path.basename(folderPath) });
	},
});

export const { expect } = test;
