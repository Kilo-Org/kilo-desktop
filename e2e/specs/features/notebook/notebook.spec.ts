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
		// And that the sidecar staged into the bundle actually runs from there.
		// Only e2e can catch this: `pnpm test` stubs the binary path away, so a
		// daemon that ships but never spawns looks green at every other tier.
		await notebookPage.verifyDaemonIsReachable();
	});
});
