import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import {
	click,
	clickByJS,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectElementToHaveCount,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	isElementVisible,
	pressLocatorKeyboard,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { chatModelSelectorData } from "../../../testdata/chat-model-selector.js";

/**
 * Composer model ("Select model") selector — visibility coverage only.
 *
 * The packaged e2e app has no Kilo Gateway model catalog (the gateway stub
 * returns 503 without a snapshot), so this page asserts only what the real
 * composer renders: the trigger, the menu shell, the provider rail with its
 * Favorites and Local Model Server buttons, the search box, and the two empty
 * states. Selecting a model, favorites toggling, persistence, and the gateway
 * model list are deliberately out of scope.
 */
export class ChatModelSelectorPage {
	private readonly trigger = () => getLocatorByTestId(chatModelSelectorData.locators.triggerTestId);
	private readonly menu = () => getLocatorByTestId(chatModelSelectorData.locators.menuTestId);
	private readonly searchInput = () => getLocator(chatModelSelectorData.locators.searchInput);
	private readonly rail = () => getLocatorByTestId(chatModelSelectorData.locators.railTestId);
	private readonly railFavorites = () =>
		getLocatorByTestId(chatModelSelectorData.locators.railFavoritesTestId);
	private readonly railLocalServer = () =>
		getLocatorByTestId(chatModelSelectorData.locators.railLocalServerTestId);
	private readonly list = () => getLocatorByTestId(chatModelSelectorData.locators.listTestId);
	private readonly modelOptions = () =>
		getLocatorByTestId(chatModelSelectorData.locators.modelOptionTestIdPattern);
	private readonly emptyIcon = () => this.menu().locator(chatModelSelectorData.locators.emptyIcon);
	private readonly addLocalModelButton = () =>
		getLocatorByRole("button", { name: chatModelSelectorData.addLocalModelButtonName });

	async openModelSelector(): Promise<void> {
		await this.waitForTriggerSettled();
		await click(this.trigger());
	}

	async selectFavorites(): Promise<void> {
		await this.selectRail(this.railFavorites());
	}

	async selectLocalModelServer(): Promise<void> {
		await this.selectRail(this.railLocalServer());
	}

	async closeWithEscape(): Promise<void> {
		await pressLocatorKeyboard(this.searchInput(), "Escape");
	}

	async verifyTriggerVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.trigger(),
			"Composer should show the model selector trigger",
		);
	}

	async verifyMenuOpen(): Promise<void> {
		await expectElementToBeVisible(this.menu(), "Model selector menu should be open");
	}

	async verifyMenuClosed(): Promise<void> {
		await expectElementToBeHidden(this.menu(), "Model selector menu should be closed");
	}

	async verifyRailVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.rail(),
			"Model selector menu should show the provider rail",
		);
	}

	async verifyFavoritesButtonVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.railFavorites(),
			"Provider rail should show the Favorites button",
		);
	}

	async verifyLocalServerButtonVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.railLocalServer(),
			"Provider rail should show the Local Model Server button",
		);
	}

	async verifySearchVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.searchInput(),
			"Model selector menu should show the search box",
		);
	}

	async verifySearchPlaceholder(): Promise<void> {
		await expectElementToHaveAttribute(
			this.searchInput(),
			"placeholder",
			chatModelSelectorData.searchPlaceholder,
			{
				message: `Model search box should be labelled "${chatModelSelectorData.searchPlaceholder}"`,
			},
		);
	}

	async verifyFavoritesEmptyMessage(): Promise<void> {
		await expectElementToBeVisible(
			this.list().getByText(chatModelSelectorData.copy.noFavorites),
			`Favorites list should show only "${chatModelSelectorData.copy.noFavorites}"`,
		);
		await expectElementToHaveCount(this.modelOptions(), 0, {
			message: "Favorites list should render no model rows",
		});
	}

	async verifyLocalServerEmptyState(): Promise<void> {
		await expectElementToBeVisible(
			this.emptyIcon(),
			"Local Model Server empty state should show an icon",
		);
		await expectElementToBeVisible(
			this.menu().getByText(chatModelSelectorData.copy.localServerTitle),
			`Local Model Server empty state should show "${chatModelSelectorData.copy.localServerTitle}"`,
		);
		await expectElementToBeVisible(
			this.menu().getByText(chatModelSelectorData.copy.localServerDescription),
			"Local Model Server empty state should show its description",
		);
		await expectElementToBeVisible(
			this.addLocalModelButton(),
			`Local Model Server empty state should show the "${chatModelSelectorData.addLocalModelButtonName}" button`,
		);
	}

	/**
	 * Switch the rail view, converging: the popover keeps re-rendering while the
	 * catalog settles, which remounts the rail buttons and drops a coordinate click
	 * mid-flight (Playwright reports "element is not stable" then "detached"). The
	 * rail button is a plain `click` target, so a DOM click is deterministic — the
	 * same workaround the mode selector uses for this composer's animated popups.
	 */
	private async selectRail(target: Locator): Promise<void> {
		await expect(async () => {
			if (!(await isElementVisible(this.menu()))) {
				await this.openModelSelector();
			}
			await clickByJS(target);
			await expectElementToHaveAttribute(target, "aria-pressed", "true", {
				message: "Selected provider rail should be active",
			});
		}).toPass({ timeout: chatModelSelectorData.railConvergeTimeoutMs });
	}

	/**
	 * The catalog is fetched once the composer settles; the trigger carries
	 * `aria-busy` until then, and the rail only renders after it resolves.
	 */
	private async waitForTriggerSettled(): Promise<void> {
		await getPage().waitForFunction(
			(triggerId) => {
				const trigger = document.querySelector(`[data-qa-id="${triggerId}"]`);
				return trigger !== null && !trigger.hasAttribute("aria-busy");
			},
			chatModelSelectorData.locators.triggerTestId,
			{ timeout: chatModelSelectorData.settleTimeoutMs },
		);
	}
}
