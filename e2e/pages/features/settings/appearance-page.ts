import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectElementToHaveCSS,
	expectElementToHaveText,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	pressLocatorKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { appearanceData, px, type TextSizeSetting } from "../../../testdata/appearance.js";

const { sidebarVibrancy } = appearanceData;

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
	 * Text that renders at the setting's size: a `text-sm` siderail entry outside the Appearance
	 * page for the interface, and the preview's prompt bubble for chat.
	 */
	private readonly renderedText = (setting: TextSizeSetting) =>
		setting.id === "ui"
			? getLocatorByTestId("settings-section-about")
			: getLocatorByTestId("appearance-chat-text-preview").locator(":scope > p");

	async openAppearanceSettings(): Promise<void> {
		await click(getLocatorByTestId("settings-section-appearance"));
		await expectElementToBeVisible(this.appearanceSettings(), "Appearance settings should open");
	}

	/** Reloads at home so the next open re-reads the stored text sizes. */
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
}
