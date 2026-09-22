import { test } from "../fixtures.js";

test.use({ appIsolationKey: "workspaces" });

test.describe("Workspaces", () => {
	test("creates an unnamed workspace from the native folder picker", async ({
		workspacesPage,
		workspaceFolder,
	}) => {
		await workspacesPage.createWorkspaceFromFolder(workspaceFolder.path, workspaceFolder.name);
	});
});
