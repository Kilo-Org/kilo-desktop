import { test } from "../../fixtures/pages.js";

test.describe("Pages @smoke @packaged", () => {
	test("opens a Pages pane from the launcher and settles", async ({ appShellPage, pagesPage }) => {
		test.slow();
		await appShellPage.verifyShellIsLoaded();
		await pagesPage.startPagesSession();
		await pagesPage.verifySettled();
	});
});
