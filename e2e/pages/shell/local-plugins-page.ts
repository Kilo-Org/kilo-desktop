import {
	click,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveAttribute,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

/** Settings → Plugins (kilo.shell over `kernel/plugins`), and the example local plugin's page. */
export class LocalPluginsPage {
	private readonly toggle = () => getLocatorByTestId("local-plugins-enabled");
	private readonly pluginRow = (folder: string) => getLocatorByTestId(`local-plugin-${folder}`);

	async open(): Promise<void> {
		await click(getLocatorByTestId("settings-section-local-plugins"));
		await expectElementToBeVisible(
			getLocatorByTestId("local-plugins-settings"),
			"Plugins settings should open from the settings navigation",
		);
	}

	async enable(): Promise<void> {
		await click(this.toggle());
		await expectElementToHaveAttribute(this.toggle(), "aria-checked", "true", {
			message: "Local plugins should be on",
		});
	}

	async approve(folder: string): Promise<void> {
		await expectElementToContainText(this.pluginRow(folder), "Disabled", {
			message: `The "${folder}" plugin should be listed, disabled`,
		});
		await click(this.pluginRow(folder).getByTestId("local-plugin-allowed"));
		await expectElementToContainText(this.pluginRow(folder), "Starts after restart", {
			message: `The "${folder}" plugin should start after a restart once approved`,
		});
		await expectElementToBeVisible(
			getLocatorByTestId("local-plugins-restart"),
			"Plugins settings should offer a restart",
		);
	}

	async verifyActive(folder: string): Promise<void> {
		await expectElementToContainText(this.pluginRow(folder), "Active", {
			message: `The "${folder}" plugin should be active after the restart`,
		});
	}

	async openExamplePage(): Promise<void> {
		await click(getLocatorByTestId("settings-section-local-hello"));
		await expectElementToBeVisible(
			getLocatorByTestId("local-hello-page"),
			"The local plugin's settings page should render inside the app",
		);
	}

	async countOnce(): Promise<void> {
		await expectElementToContainText(getLocatorByTestId("local-hello-count"), "Counted 0 times", {
			message: "The local plugin's counter should start at zero",
		});
		await click(getLocatorByTestId("local-hello-increment"));
		await expectElementToContainText(getLocatorByTestId("local-hello-count"), "Counted 1 times", {
			message: "The local plugin's main entry should count the press",
		});
	}
}
