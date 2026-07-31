import { test } from "../../../fixtures/features/theme.js";

test.describe("Theme @smoke", () => {
	test("applies the color scheme on shell boot", async ({ appShellPage }) => {
		await appShellPage.verifyColorSchemeApplied();
	});

	test("keeps the persisted dark scheme through a refresh before React loads", async ({
		themePage,
	}) => {
		await themePage.setStoredThemeSource("dark");
		await themePage.reload();
		await themePage.verifyEarlyDataTheme("dark");
		await themePage.verifyWindowBackgroundMatchesPage();

		await themePage.setStoredThemeSource("system");
		await themePage.reload();
	});
});
