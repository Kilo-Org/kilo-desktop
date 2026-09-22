import { test } from "../../../fixtures/features/workspace.js";

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
