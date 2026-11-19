import {
	click,
	expectElementToBeVisible,
	expectElementToContainText,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

/** Page object for Settings → Terminal (kilo.terminal's shell profiles). */
export class TerminalSettingsPage {
	private readonly sectionEntry = () => getLocatorByTestId("settings-section-terminal");
	private readonly page = () => getLocatorByTestId("terminal-settings");
	private readonly defaultShell = () => getLocatorByTestId("terminal-default-profile");
	private readonly option = (profileId: string) =>
		getLocatorByTestId(`terminal-profile-option-${profileId}`);

	/** Opens the Terminal section; Settings must already be open. */
	async open(): Promise<void> {
		await click(this.sectionEntry());
		await expectElementToBeVisible(this.page(), "Settings → Terminal should show its page");
	}

	async verifyDefaultShell(label: string): Promise<void> {
		await expectElementToContainText(this.defaultShell(), label, {
			message: `The default shell should read "${label}"`,
		});
	}

	/** Opens the default-shell menu and checks that Automatic is offered. */
	async verifyAutomaticOffered(): Promise<void> {
		await click(this.defaultShell());
		await expectElementToBeVisible(
			this.option("automatic"),
			"The default shell menu should offer Automatic",
		);
	}
}
