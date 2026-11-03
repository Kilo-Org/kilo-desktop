import { test } from "../../../fixtures/features/notebook.js";
import { SIGNED_OUT_LAUNCH_ENV } from "../../../testdata/account.js";

// Its own worker app, launched signed out. A worker option can't be set inside
// a describe group, so the signed-out spec lives in its own file.
test.use({ appLaunchEnv: SIGNED_OUT_LAUNCH_ENV });

test.describe("Notebook signed out @smoke @packaged", () => {
	test("offers a Notebook pane that asks a signed-out user to sign in", async ({
		appShellPage,
		notebookPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await notebookPage.openLauncher();
		await notebookPage.verifyNotebookNeedsSignIn();
	});
});
