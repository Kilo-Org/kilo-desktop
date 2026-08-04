import { test } from "../../../fixtures/features/notebook.js";

test.describe("Notebook @smoke", () => {
	test("opens the notebook surface and answers its status channel", async ({
		appShellPage,
		notebookPage,
	}) => {
		await appShellPage.navigateToFeature("notebook");
		await notebookPage.verifySurfaceIsOpen();
		// Proves the main-process feature booted and registered `notebook:status`
		// in the packaged binary. The daemon itself is not bundled yet, so only
		// the relay port is asserted — `daemon` stays null until the sidecar ships.
		await notebookPage.verifyStatusChannelReportsBoundRelay();
	});
});
