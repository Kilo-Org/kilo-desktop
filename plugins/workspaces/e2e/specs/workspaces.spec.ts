import { test } from "../fixtures.js";

test.describe("Workspaces @smoke", () => {
	test("creates an unnamed workspace from the native folder picker", async ({
		workspacesPage,
		workspaceFolder,
	}) => {
		await workspacesPage.createWorkspaceFromFolder(workspaceFolder.name);
	});
});
