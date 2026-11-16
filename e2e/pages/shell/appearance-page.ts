import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveAttribute,
	expectElementToHaveCSS,
	expectElementToHaveText,
	getLocator,
	getLocatorByRole,
	getAttribute,
	getLocatorByTestId,
	getLocatorCount,
	getText,
	logger,
	pressLocatorKeyboard,
	pressPageKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect, type Locator } from "@playwright/test";

import {
	appearanceData,
	colorThemeData,
	px,
	type AccentColor,
	type ColorTheme,
	type TextSizeSetting,
} from "../../testdata/appearance.js";
import { callDomainObject } from "../../utils/kernel-bridge.js";

const { accentColor } = colorThemeData;
const { sidebarVibrancy, textSizeSettings } = appearanceData;

/** Paints the element's background on a canvas so oklch, color-mix and rgb compare as sRGB bytes. */
const readBackgroundAsSrgb = (element: Locator): Promise<number[]> =>
	element.evaluate((node) => {
		const context = document.createElement("canvas").getContext("2d")!;
		context.fillStyle = getComputedStyle(node).backgroundColor;
		context.fillRect(0, 0, 1, 1);
		return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
	});

const largestChannelGap = (a: number[], b: number[]): number =>
	Math.max(...a.map((channel, index) => Math.abs(channel - b[index]!)));

const containsColor = (accent: AccentColor): RegExp =>
	new RegExp((accent.ringRgb ?? accent.rgb).replace(/[()]/g, "\\$&"));

export class AppearancePage {
	private readonly appearanceSettings = () => getLocatorByTestId("appearance-settings");
	private readonly documentRoot = () => getLocator("html");
	private readonly sidebarVibrancySwitch = () => getLocatorByTestId("appearance-sidebar-vibrancy");
	// The sliders have no test id; each range input is named by its row title.
	private readonly slider = (setting: TextSizeSetting) =>
		getLocatorByRole("slider", { name: setting.title });
	private readonly value = (setting: TextSizeSetting) =>
		getLocatorByTestId(`appearance-${setting.id}-text-size-value`);
	private readonly resetButton = (setting: TextSizeSetting) =>
		getLocatorByRole("button", { name: setting.resetLabel });
	/**
	 * Text that renders at the setting's size: a `text-sm` siderail entry for the interface, and
	 * the preview's prompt bubble for chat.
	 */
	private readonly renderedText = (setting: TextSizeSetting) =>
		setting.id === "ui"
			? getLocatorByTestId("settings-section-appearance")
			: getLocatorByTestId("appearance-chat-text-preview").locator(":scope > p");

	private readonly colorThemePicker = () => getLocatorByTestId("appearance-color-theme");
	private readonly colorThemeOption = (theme: ColorTheme) =>
		getLocatorByTestId(`appearance-color-theme-${theme.id}`);
	// Options render in a portal; the prefix excludes the picker trigger itself.
	private readonly colorThemeOptions = () => getLocator('[data-qa-id^="appearance-color-theme-"]');
	// The "Aa" chip painted with the theme's own background.
	private readonly colorThemeSwatch = (option: Locator) =>
		option.locator('span[aria-hidden="true"]', { hasText: "Aa" });
	// Painted with `bg-background`, so it shows the applied theme's background.
	private readonly themedSurface = () => getLocatorByTestId("appearance-chat-text-preview");
	private readonly accentSwatch = (accent: AccentColor) =>
		getLocatorByTestId(`appearance-accent-${accent.id}`);
	// Only colour swatches render a dot; text options such as "Theme" do not.
	private readonly customAccentSwatches = () =>
		getLocator('[data-qa-id^="appearance-accent-"]:has(> span[aria-hidden="true"])');
	private readonly selectedThemeCard = () =>
		getLocatorByTestId(`appearance-theme-${accentColor.selectedThemeCard}`);
	// The slider's filled part (`bg-primary`) and its thumb (`border-ring`) carry the accent.
	private readonly sliderFill = (setting: TextSizeSetting) =>
		this.sliderControl(setting).locator('[data-slot="slider-range"]');
	private readonly sliderThumb = (setting: TextSizeSetting) =>
		this.sliderControl(setting).locator('[data-slot="slider-thumb"]');
	private readonly sliderControl = (setting: TextSizeSetting) =>
		this.appearanceSettings().locator('[data-slot="slider"]', { has: this.slider(setting) });

	async openAppearanceSettings(): Promise<void> {
		await click(getLocatorByTestId("settings-section-appearance"));
		await expectElementToBeVisible(this.appearanceSettings(), "Appearance settings should open");
	}

	/**
	 * Appearance is saved in main (`kilo.shell/appearance`), so tests reset it
	 * as kilo.shell's window does rather than by clearing renderer storage.
	 * Setup only; the behaviour under test goes through the page.
	 */
	async resetAppearance(): Promise<void> {
		await callDomainObject({
			domainId: appearanceData.domainId,
			method: "update",
			input: appearanceData.defaults,
			caller: appearanceData.ownerId,
		});
	}

	/** Reloads at home so the next open re-reads the saved appearance. */
	async reloadApp(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/";
		});
		await reloadPage();
	}

	async toggleSidebarVibrancy(): Promise<void> {
		await click(this.sidebarVibrancySwitch());
	}

	async verifySidebarVibrancyOn(): Promise<void> {
		await expectElementToHaveAttribute(this.sidebarVibrancySwitch(), "aria-checked", "true", {
			message: "Sidebar vibrancy should be on",
		});
		await expectElementToHaveCSS(
			this.documentRoot(),
			sidebarVibrancy.cssVar,
			sidebarVibrancy.onOpacity,
			{ message: "The sidebar glass should use the theme's translucent opacity" },
		);
		await expectElementToHaveCSS(
			this.documentRoot(),
			"background-color",
			sidebarVibrancy.translucentBackground,
			{ message: "The window background should stay translucent while vibrancy is on" },
		);
	}

	async verifySidebarVibrancyOff(): Promise<void> {
		await expectElementToHaveAttribute(this.sidebarVibrancySwitch(), "aria-checked", "false", {
			message: "Sidebar vibrancy should be off",
		});
		await expectElementToHaveCSS(
			this.documentRoot(),
			sidebarVibrancy.cssVar,
			sidebarVibrancy.offOpacity,
			{ message: "The sidebar glass should be fully opaque while vibrancy is off" },
		);
		await expectElementToHaveCSS(
			this.documentRoot(),
			"background-color",
			sidebarVibrancy.opaqueBackground,
			{ message: "The window background should be opaque while vibrancy is off" },
		);
	}

	async increaseTextSize(setting: TextSizeSetting): Promise<void> {
		await pressLocatorKeyboard(this.slider(setting), "ArrowRight");
	}

	async setTextSizeToMinimum(setting: TextSizeSetting): Promise<void> {
		await pressLocatorKeyboard(this.slider(setting), "Home");
	}

	async setTextSizeToMaximum(setting: TextSizeSetting): Promise<void> {
		await pressLocatorKeyboard(this.slider(setting), "End");
	}

	async clickResetTextSize(setting: TextSizeSetting): Promise<void> {
		await click(this.resetButton(setting));
	}

	async verifyTextSize(setting: TextSizeSetting, size: number): Promise<void> {
		await expectElementToHaveText(this.value(setting), px(size), {
			message: `${setting.title} should read ${px(size)}`,
		});
		await expectElementToHaveCSS(this.documentRoot(), setting.cssVar, px(size), {
			message: `The app should apply ${px(size)} as its ${setting.title.toLowerCase()}`,
		});
		await expectElementToHaveCSS(this.renderedText(setting), "font-size", px(size), {
			message: `Text driven by the ${setting.title.toLowerCase()} should render at ${px(size)}`,
		});
	}

	async verifyTextSizeAtDefault(setting: TextSizeSetting): Promise<void> {
		await this.verifyTextSize(setting, setting.defaultPx);
	}

	async verifyResetOffered(setting: TextSizeSetting): Promise<void> {
		await expectElementToBeVisible(
			this.resetButton(setting),
			`Reset should be offered once the ${setting.title.toLowerCase()} differs from the default`,
		);
	}

	/** The button stays mounted but `invisible`, which also removes it from the a11y tree. */
	async verifyResetNotOffered(setting: TextSizeSetting): Promise<void> {
		await expectElementToBeHidden(
			this.resetButton(setting),
			`Reset should not be offered at the default ${setting.title.toLowerCase()}`,
		);
	}

	async openColorThemePicker(): Promise<void> {
		await click(this.colorThemePicker());
	}

	async chooseColorTheme(theme: ColorTheme): Promise<void> {
		await click(this.colorThemeOption(theme));
	}

	async closeColorThemePicker(): Promise<void> {
		await pressPageKeyboard("Escape");
	}

	/**
	 * Reads the themes from the open picker, so added or changed themes need no test data update.
	 * Each option's swatch uses the same tokens the app applies, which makes it the expected colour.
	 */
	async getColorThemeOptions(): Promise<ColorTheme[]> {
		// The listbox renders its options after the trigger opens it; wait for the default theme.
		await expectElementToBeVisible(
			getLocatorByTestId("appearance-color-theme-kilo"),
			"The color theme picker should open and list the default theme",
		);
		const count = await getLocatorCount(this.colorThemeOptions());
		if (count === 0) throw new Error("The color theme picker should list at least one theme");
		const themes: ColorTheme[] = [];
		for (let index = 0; index < count; index++) {
			// nth: options are siblings told apart only by the id this loop is reading.
			const option = this.colorThemeOptions().nth(index);
			const swatch = this.colorThemeSwatch(option);
			const qaId = (await getAttribute(option, "data-qa-id"))!;
			themes.push({
				id: qaId.replace("appearance-color-theme-", ""),
				name: (await getText(option)).replace(await getText(swatch), "").trim(),
				background: await readBackgroundAsSrgb(swatch),
			});
		}
		logger.info(
			`Color themes: ${themes.map(({ name, background }) => `${name} rgb(${background.join(", ")})`).join(", ")}`,
		);
		return themes;
	}

	async verifyColorThemeApplied(theme: ColorTheme): Promise<void> {
		await expectElementToContainText(this.colorThemePicker(), theme.name, {
			message: `The color theme picker should show ${theme.name} as selected`,
		});
		// Off by one at most: the default palette is oklch, which rounds differently from the swatch hex.
		await expect
			.poll(
				async () =>
					largestChannelGap(await readBackgroundAsSrgb(this.themedSurface()), theme.background),
				{ message: `The app background should switch to the ${theme.name} palette` },
			)
			.toBeLessThanOrEqual(1);
	}

	/** Reads the accent from its swatch, so added or changed accents need no test data update. */
	async pickRandomCustomAccent(): Promise<AccentColor> {
		const count = await getLocatorCount(this.customAccentSwatches());
		if (count === 0) throw new Error("The accent picker should list at least one custom accent");
		// nth: the swatches are siblings with no other distinguishing attribute to pick a random one by.
		const swatch = this.customAccentSwatches().nth(Math.floor(Math.random() * count));
		const qaId = (await getAttribute(swatch, "data-qa-id"))!;
		const accent = {
			id: qaId.replace("appearance-accent-", ""),
			name: (await getAttribute(swatch, "aria-label"))!,
			rgb: await swatch
				.locator(':scope > span[aria-hidden="true"]')
				.evaluate((dot) => getComputedStyle(dot).backgroundColor),
		};
		logger.info(`Picked the ${accent.name} accent (${accent.rgb})`);
		return accent;
	}

	async selectAccent(accent: AccentColor): Promise<void> {
		await click(this.accentSwatch(accent));
	}

	async verifyAccentApplied(accent: AccentColor): Promise<void> {
		await expectElementToHaveAttribute(this.accentSwatch(accent), "aria-pressed", "true", {
			message: `The ${accent.name} accent swatch should be selected`,
		});
		// box-shadow also lists the transparent shadow layers, so match the accent within it.
		await expectElementToHaveCSS(this.selectedThemeCard(), "box-shadow", containsColor(accent), {
			message: `The selected theme card should be outlined in the ${accent.name} accent`,
		});
		for (const { setting } of textSizeSettings) {
			await expectElementToHaveCSS(this.sliderFill(setting), "background-color", accent.rgb, {
				message: `The ${setting.title.toLowerCase()} slider should fill with the ${accent.name} accent`,
			});
			await expectElementToHaveCSS(
				this.sliderThumb(setting),
				"border-color",
				accent.ringRgb ?? accent.rgb,
				{
					message: `The ${setting.title.toLowerCase()} slider thumb should be outlined in the ${accent.name} accent`,
				},
			);
		}
	}

	async verifyAccentNotSelected(accent: AccentColor): Promise<void> {
		await expectElementToHaveAttribute(this.accentSwatch(accent), "aria-pressed", "false", {
			message: `The ${accent.name} accent swatch should not be selected`,
		});
	}
}
