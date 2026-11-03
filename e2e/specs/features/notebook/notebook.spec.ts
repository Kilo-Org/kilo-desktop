import { test } from "../../../fixtures/features/notebook.js";

test.describe("Notebook @smoke @packaged", () => {
	test("offers a Notebook pane to a signed-in user", async ({ appShellPage, notebookPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await notebookPage.openLauncher();
		await notebookPage.verifyNotebookAvailable();
	});
});
