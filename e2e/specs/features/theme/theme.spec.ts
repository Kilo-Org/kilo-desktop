import { test } from "../../../fixtures/shell.js";

test.describe("Theme @smoke", () => {
	test("applies ThemeSync on shell boot", async ({ appShellPage }) => {
		await appShellPage.verifyThemeSyncApplied();
	});
});
