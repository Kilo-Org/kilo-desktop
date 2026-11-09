import { test } from "../../../fixtures/features/workspace.js";

test.describe("Workspaces @packaged", () => {
	test("adds a workspace from the folder picker and lists it @smoke", async ({
		appShellPage,
		workspacesPage,
		watchedFolder,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await workspacesPage.addWorkspaceFromPicker(watchedFolder.name);
		await workspacesPage.verifyListed(watchedFolder.name);
	});
});
