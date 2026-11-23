import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveAttribute,
	fill,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Reading Mode in an open session's Agent pane: Focus (the full-window
 * take-over), saving reply text, the Saved page it lands on, and reading
 * presets in the transcript's Aa control.
 */
export class ReadingPage {
	private readonly agentPane = () => getLocatorByTestId("kilo-agent-pane");
	private readonly replyParagraph = (text: string) =>
		this.agentPane().locator('[data-reading-surface="reply"]').getByText(text).first();
	private readonly focusRailButton = () => getLocatorByTestId("chat-focus-rail-button");
	private readonly takeover = () => getLocatorByTestId("shell-takeover");
	private readonly focusContent = () => getLocatorByTestId("chat-focus-content");
	private readonly saveButton = () => getLocatorByTestId("chat-selection-menu-save");
	private readonly toastView = () => getLocatorByTestId("chat-saved-toast-view");
	private readonly savedView = () => getLocatorByTestId("saved-view");
	private readonly savedRows = () => getLocatorByTestId("saved-row");
	private readonly aa = (id: string) => getLocatorByTestId(`chat-reading-chat-${id}`);
	private readonly presetsTrigger = () => this.aa("presets-trigger");
	private readonly presetMenuItem = (name: string) =>
		getPage().getByRole("menuitem", { name: `Apply ${name}` });

	/** Hovers a reply paragraph and enters Focus from its "Focus from here" rail. */
	async focusFrom(text: string): Promise<void> {
		await this.replyParagraph(text).hover();
		await click(this.focusRailButton());
		await expectElementToBeVisible(this.takeover(), {
			message: "Focus should cover the whole window.",
		});
		await expectElementToContainText(this.focusContent(), text, {
			message: "Focus should show the reply.",
		});
	}

	async exitFocusWithEscape(): Promise<void> {
		await getPage().keyboard.press("Escape");
		await expectElementToBeHidden(this.takeover(), { message: "Esc should leave Focus." });
	}

	/** Selects a reply paragraph (triple click) and saves it from the selection menu. */
	async saveParagraph(text: string): Promise<void> {
		await this.replyParagraph(text).click({ clickCount: 3 });
		await click(this.saveButton());
	}

	/** Opens the Saved page from the "Added to Saved" toast. */
	async viewSavedFromToast(): Promise<void> {
		await click(this.toastView());
		await expectElementToBeVisible(this.savedView(), {
			message: "View should open the Saved page.",
		});
	}

	async verifySavedRow(text: string): Promise<void> {
		await expectElementToContainText(this.savedRows().first(), text, {
			message: "The saved text should be listed on the Saved page.",
		});
	}

	/** Clicks the saved row and checks the chat is back in view. */
	async openSavedRow(text: string): Promise<void> {
		await click(this.savedRows().filter({ hasText: text }).getByTestId("saved-row-open"));
		await expectElementToBeVisible(this.replyParagraph(text), {
			message: "Opening a saved row should go back to its chat.",
		});
	}

	/** Opens the Aa reading panel above the composer. */
	async openReadingPanel(): Promise<void> {
		await click(this.aa("trigger"));
		await expectElementToBeVisible(this.aa("popover"), {
			message: "The Aa control should open the Reading panel.",
		});
	}

	/** Picks a reading theme swatch, which leaves unsaved changes. */
	async pickReadingTheme(name: string): Promise<void> {
		await click(this.aa("popover").getByRole("radio", { name }));
		await expectElementToBeVisible(this.aa("presets-unsaved"), {
			message: "Changing a setting should mark the presets button as unsaved.",
		});
	}

	async makeTextLarger(): Promise<void> {
		await this.aa("size-slider").locator('input[type="range"]').focus();
		await getPage().keyboard.press("ArrowRight");
	}

	/**
	 * Saves the current settings as a new preset: from the header's Save… link
	 * with no preset active, else from the menu (the header offers Update then).
	 */
	async savePreset(name: string, { fromMenu = false } = {}): Promise<void> {
		if (fromMenu) {
			await click(this.presetsTrigger());
			await click(this.aa("preset-save-current"));
		} else {
			await click(this.aa("preset-save"));
		}
		await fill(this.aa("preset-name"), name);
		await click(this.aa("preset-save-confirm"));
		await expectElementToBeHidden(this.aa("preset-save-dialog"), {
			message: "Saving should close the Save dialog.",
		});
		await this.verifyActivePreset(name);
	}

	/** The presets button names the active preset and shows nothing unsaved. */
	async verifyActivePreset(name: string): Promise<void> {
		await expectElementToContainText(this.presetsTrigger(), name, {
			message: `The presets button should name ${name}.`,
		});
		await expectElementToBeHidden(this.aa("presets-unsaved"), {
			message: "The active preset should have no unsaved changes.",
		});
	}

	async applyPreset(name: string): Promise<void> {
		await click(this.presetsTrigger());
		await click(this.presetMenuItem(name));
		await this.verifyActivePreset(name);
	}

	/** Updates the edited active preset from the header's Update link (Save… turns into it). */
	async updateActivePreset(name: string): Promise<void> {
		await expectElementToHaveAttribute(this.aa("preset-update"), "aria-label", `Update “${name}”`, {
			message: "The header should offer to update the edited preset.",
		});
		await click(this.aa("preset-update"));
		await this.verifyActivePreset(name);
	}

	/** Stars a preset in Manage reading presets, then closes the dialog. */
	async setDefaultPreset(name: string): Promise<void> {
		await click(this.presetsTrigger());
		await click(this.aa("preset-manage"));
		const dialog = this.aa("preset-manage-dialog");
		await click(dialog.getByRole("button", { name: `Apply ${name} when Kilo opens` }));
		await expectElementToHaveAttribute(
			dialog.getByRole("button", { name: "Stop applying when Kilo opens" }),
			"aria-pressed",
			"true",
			{ message: `${name} should be starred.` },
		);
		await click(this.aa("preset-manage-done"));
		await expectElementToBeHidden(dialog, { message: "Done should close Manage." });
		await click(this.presetsTrigger());
		await expectElementToContainText(this.presetMenuItem(name), "Default", {
			message: `${name} should carry the Default badge.`,
		});
		await getPage().keyboard.press("Escape");
	}
}
