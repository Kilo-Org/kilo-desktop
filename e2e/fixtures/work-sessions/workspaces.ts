import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorkspaceWatcherPage } from "../../pages/work-sessions/workspace-watcher-page.js";
import { WorkspacesPage } from "../../pages/work-sessions/workspaces-page.js";
import { test as workSessionsTest } from "../work-sessions.js";
import { removePathAfterAppStops } from "../shell.js";

type WorkspaceFixtures = {
	watcherPage: WorkspaceWatcherPage;
	watchedFolder: { path: string; name: string };
	/** The workspace dialogs, with the native folder picker answering `watchedFolder`. */
	workspacesPage: WorkspacesPage;
};

/**
 * kilo.work-sessions' workspaces, in an app of their own (each spec adds a
 * workspace and makes it active), with the session list and New Session page
 * of the base fixture.
 */
export const test = workSessionsTest.extend<WorkspaceFixtures>({
	appIsolationKey: "workspaces",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	watcherPage: async ({}, use) => {
		await use(new WorkspaceWatcherPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	watchedFolder: async ({}, use) => {
		// A real folder the packaged app's native watcher can subscribe to.
		// Resolve to the canonical path first — kilo.work-sessions registers
		// folders by their realpath, and the watcher reports event paths under
		// the registered root (macOS temp dirs are /var → /private/var symlinks).
		// Removal is deferred until the app stops (Windows holds open handles).
		const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-workspace-watch-"));
		const folderPath = await realpath(rawPath);
		removePathAfterAppStops(rawPath);
		removePathAfterAppStops(folderPath);
		await use({ path: folderPath, name: path.basename(folderPath) });
	},
	workspacesPage: async ({ electronApp, watchedFolder }, use) => {
		await electronApp.evaluate(({ dialog }, selectedPath) => {
			type Globals = typeof globalThis & {
				__workspaceOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
			};
			const globals = globalThis as Globals;
			globals.__workspaceOriginalShowOpenDialog ??= dialog.showOpenDialog;
			(dialog as { showOpenDialog: typeof dialog.showOpenDialog }).showOpenDialog = async () => ({
				canceled: false,
				filePaths: [selectedPath],
				bookmarks: [],
			});
		}, watchedFolder.path);

		await use(new WorkspacesPage());

		await electronApp.evaluate(({ dialog }) => {
			type Globals = typeof globalThis & {
				__workspaceOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
			};
			const globals = globalThis as Globals;
			if (globals.__workspaceOriginalShowOpenDialog) {
				(dialog as { showOpenDialog: typeof dialog.showOpenDialog }).showOpenDialog =
					globals.__workspaceOriginalShowOpenDialog;
				delete globals.__workspaceOriginalShowOpenDialog;
			}
		});
	},
});

export const { expect } = test;
