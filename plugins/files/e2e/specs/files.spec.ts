import { test } from "../fixtures.js";

test.describe("Files @smoke", () => {
	test("opens the bundled files pane and exposes a workspace file", async ({
		appShellPage,
		filesPage,
		filesWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await filesPage.createAndSelectWorkspace(filesWorkspace.path, filesWorkspace.name);
		await filesPage.openFilesPane();
		await filesPage.verifyFileIsExposed(filesWorkspace.fileName);
	});
});
