import { test } from "../../../fixtures/features/notebook.js";

test.describe("Notebook @smoke", () => {
	test("opens the notebook surface and answers its status channel", async ({
		appShellPage,
		notebookPage,
	}) => {
		await appShellPage.navigateToFeature("notebook");
		await notebookPage.verifySurfaceIsOpen();
		// The packaged renderer must frame the notebook protocol host. Only e2e
		// exercises the real `window.location.origin` this is derived from.
		await notebookPage.verifyFramesTheNotebookOrigin();
		// Proves the main-process feature booted and registered `notebook:status`
		// in the packaged binary.
		await notebookPage.verifyStatusChannelReportsBoundRelay();
		// When the environment bootstrapped runtimed explicitly, prove the packaged
		// app attaches to that same external singleton.
		await notebookPage.verifyDaemonIsReachable();
	});
});
