import { test } from "../fixtures.js";

test.describe("Files @smoke", () => {
	test("opens the bundled right-panel plugin and exposes a workspace file", async ({
		appShellPage,
		filesPage,
		filesWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await filesPage.createAndSelectWorkspace(filesWorkspace.path, filesWorkspace.name);
		await filesPage.openFilesPanel();
		await filesPage.verifyFileIsExposed(filesWorkspace.fileName);
	});
});
