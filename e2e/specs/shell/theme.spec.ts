import { test } from "../../fixtures/shell/theme.js";
import { themeData } from "../../testdata/theme.js";

test.describe("Theme @smoke @packaged", () => {
	test("restores the palette and native chrome after an app restart", async ({ themePage }) => {
		await themePage.verifyThemeSurvivesRestart();
	});

	// Ends on Dark, the default, so the worker's shared theme profile is left as it started.
	test("syncs native appearance live when switching between Light, System, and Dark", async ({
		appShellPage,
		themePage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await themePage.openAppearanceSettings();
		for (const source of [
			themeData.sources.light,
			themeData.sources.system,
			themeData.sources.dark,
		]) {
			await test.step(`selects ${source}`, async () => {
				await themePage.selectThemeSource(source);
				await themePage.verifyNativeThemeSource(source);
			});
		}
	});
});
