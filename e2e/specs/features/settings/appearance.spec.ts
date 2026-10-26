import { test } from "../../../fixtures/features/appearance.js";
import { appearanceData, colorThemeData } from "../../../testdata/appearance.js";

const { textSizeRange, textSizeSettings } = appearanceData;
const { accentColor } = colorThemeData;

test.describe("Appearance color theme and accent @regression @packaged", () => {
	test.beforeEach(async ({ appShellPage, appearancePage }) => {
		// The open window keeps the last choices in memory; reload so each test starts from the defaults.
		await appearancePage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appearancePage.openAppearanceSettings();
	});

	test("applies every color theme from the picker", async ({ appearancePage }) => {
		await appearancePage.openColorThemePicker();
		const colorThemes = await appearancePage.getColorThemeOptions();
		await appearancePage.closeColorThemePicker();

		for (const theme of colorThemes) {
			await test.step(`selects ${theme.name}`, async () => {
				await appearancePage.openColorThemePicker();
				await appearancePage.chooseColorTheme(theme);
				await appearancePage.verifyColorThemeApplied(theme);
			});
		}
	});

	test("applies an accent color and keeps it after a reload", async ({
		appShellPage,
		appearancePage,
	}) => {
		const accent = await appearancePage.pickRandomCustomAccent();
		await appearancePage.verifyAccentApplied(accentColor.theme);

		await appearancePage.selectAccent(accent);
		await appearancePage.verifyAccentApplied(accent);
		await appearancePage.verifyAccentNotSelected(accentColor.theme);

		await appearancePage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appearancePage.openAppearanceSettings();
		await appearancePage.verifyAccentApplied(accent);
	});

	test("restores the theme's accent color", async ({ appShellPage, appearancePage }) => {
		const accent = await appearancePage.pickRandomCustomAccent();
		await appearancePage.selectAccent(accent);
		await appearancePage.verifyAccentApplied(accent);

		await appearancePage.selectAccent(accentColor.theme);
		await appearancePage.verifyAccentApplied(accentColor.theme);
		await appearancePage.verifyAccentNotSelected(accent);

		await appearancePage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appearancePage.openAppearanceSettings();
		await appearancePage.verifyAccentApplied(accentColor.theme);
	});
});

test.describe("Appearance text size @smoke @packaged", () => {
	test.beforeEach(async ({ appShellPage, appearancePage }) => {
		// The fixture clears storage between tests, but the open window keeps the last sizes in
		// memory; reloading makes every test start from the defaults.
		await appearancePage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appearancePage.openAppearanceSettings();
	});

	for (const { setting, other } of textSizeSettings) {
		const name = setting.title.toLowerCase();

		test(`adjusts and persists the ${name}`, async ({ appShellPage, appearancePage }) => {
			await appearancePage.verifyTextSizeAtDefault(setting);

			await appearancePage.increaseTextSize(setting);
			await appearancePage.verifyTextSize(setting, setting.defaultPx + 1);
			await appearancePage.verifyTextSizeAtDefault(other);

			await appearancePage.reloadApp();
			await appShellPage.verifyShellIsLoaded();
			await appShellPage.openSettings();
			await appearancePage.openAppearanceSettings();
			await appearancePage.verifyTextSize(setting, setting.defaultPx + 1);
		});

		test(`resets the ${name} to its default`, async ({ appShellPage, appearancePage }) => {
			await appearancePage.verifyResetNotOffered(setting);

			await appearancePage.increaseTextSize(setting);
			await appearancePage.verifyResetOffered(setting);
			await appearancePage.verifyResetNotOffered(other);

			await appearancePage.clickResetTextSize(setting);
			await appearancePage.verifyTextSizeAtDefault(setting);
			await appearancePage.verifyResetNotOffered(setting);

			await appearancePage.reloadApp();
			await appShellPage.verifyShellIsLoaded();
			await appShellPage.openSettings();
			await appearancePage.openAppearanceSettings();
			await appearancePage.verifyTextSizeAtDefault(setting);
		});

		test(`limits the ${name} to its supported range`, async ({ appearancePage }) => {
			await appearancePage.setTextSizeToMaximum(setting);
			await appearancePage.verifyTextSize(setting, textSizeRange.maxPx);

			await appearancePage.setTextSizeToMinimum(setting);
			await appearancePage.verifyTextSize(setting, textSizeRange.minPx);
			await appearancePage.verifyTextSizeAtDefault(other);
		});
	}
});

test.describe("Appearance sidebar vibrancy @regression @packaged", () => {
	test.beforeEach(async ({ appShellPage, appearancePage }) => {
		// The open window keeps the last setting in memory; reload so each test starts from the default.
		await appearancePage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appearancePage.openAppearanceSettings();
	});

	test("turns sidebar vibrancy off and keeps it off after a reload", async ({
		appShellPage,
		appearancePage,
	}) => {
		await appearancePage.verifySidebarVibrancyOn();

		await appearancePage.toggleSidebarVibrancy();
		await appearancePage.verifySidebarVibrancyOff();

		await appearancePage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appearancePage.openAppearanceSettings();
		await appearancePage.verifySidebarVibrancyOff();
	});

	test("turns sidebar vibrancy back on", async ({ appShellPage, appearancePage }) => {
		await appearancePage.toggleSidebarVibrancy();
		await appearancePage.verifySidebarVibrancyOff();

		await appearancePage.toggleSidebarVibrancy();
		await appearancePage.verifySidebarVibrancyOn();

		await appearancePage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appearancePage.openAppearanceSettings();
		await appearancePage.verifySidebarVibrancyOn();
	});
});
