import { test } from "../../fixtures/work-sessions/workspaces.js";

// The watcher reads main's snapshot, which makes main forget what the window
// implements, so it runs in an app of its own (see WorkspaceWatcherPage).
test.use({ appIsolationKey: "workspace-watcher" });

test.describe("Workspace watcher @smoke @packaged", () => {
	test("publishes a file-change batch for a registered workspace folder", async ({
		appShellPage,
		watcherPage,
		watchedFolder,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await watcherPage.createWorkspace(watchedFolder.path, watchedFolder.name);
		await watcherPage.writeNewFileAndAwaitCreateChange(watchedFolder.path, "smoke-note");
	});
});
