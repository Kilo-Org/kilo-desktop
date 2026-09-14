import { test } from "../../../fixtures/features/theme.js";

test.describe("Theme @smoke", () => {
	test("restores the palette and native chrome after an app restart", async ({ themePage }) => {
		await themePage.verifyThemeSurvivesRestart();
	});
});
