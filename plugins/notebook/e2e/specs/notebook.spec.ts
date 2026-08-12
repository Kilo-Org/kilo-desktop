import { test } from "../fixtures.js";

test.describe("Notebook @smoke", () => {
	test("creates two independent scratch notebooks in the Kilo right panel", async ({
		notebookPage,
	}) => {
		await notebookPage.openKiloChat();
		await notebookPage.addTwoNotebooks();
		await notebookPage.verifyDistinctProtocolFramesAndSwitching();
		await notebookPage.verifyBundledResources();
		await notebookPage.verifyStatusChannelReportsSingleton();
		await notebookPage.verifyDaemonIsReachable();
		await notebookPage.executeCellAndVerifyOutput();
	});
});
