import { test } from "../../fixtures/work-sessions/workspaces.js";

test.describe("kilo.work-sessions @smoke", () => {
	test("adds a workspace, starts an empty session in it from the New Session page, then renames and pins it", async ({
		appShellPage,
		workspacesPage,
		watchedFolder,
		newWorkSessionPage,
		sessionListPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await workspacesPage.addWorkspaceFromPicker(watchedFolder.name);

		await newWorkSessionPage.open();
		await newWorkSessionPage.verifyStartsIn(watchedFolder.name);
		await newWorkSessionPage.startEmptySession();
		await sessionListPage.verifyListed("New session");

		await sessionListPage.rename("New session", "Smoke work session");
		await sessionListPage.verifyOpen("Smoke work session");
		await sessionListPage.pin("Smoke work session");
	});
});
