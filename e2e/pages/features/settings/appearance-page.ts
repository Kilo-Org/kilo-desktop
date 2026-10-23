import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveCSS,
	expectElementToHaveText,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	pressLocatorKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { px, type TextSizeSetting } from "../../../testdata/appearance.js";

export class AppearancePage {
	private readonly appearanceSettings = () => getLocatorByTestId("appearance-settings");
	private readonly documentRoot = () => getLocator("html");
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
