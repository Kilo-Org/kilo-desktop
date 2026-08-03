import { test } from "../../../fixtures/features/theme.js";

test.describe("Theme @smoke", () => {
	test("applies the color scheme on shell boot", async ({ appShellPage }) => {
		await appShellPage.verifyColorSchemeApplied();
	});

	test("restores the persisted dark scheme after a refresh", async ({ themePage }) => {
		await themePage.setStoredThemeSource("dark");
		await themePage.reload();
		await themePage.verifyResolvedTheme("dark");

		await themePage.setStoredThemeSource("system");
		await themePage.reload();
	});
});
