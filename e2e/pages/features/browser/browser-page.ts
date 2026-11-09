import {
	click,
	expectElementToBeDisabled,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

const BROWSER_KIND = "kilo.browser/browser";

/**
 * Page object for kilo.browser's Browser pane. A browser-only session starts
 * from the launcher (no chat needed); the pane toolbar's + adds
 * more. Deep coverage lives in kilo.browser's Vitest browser tier.
 */
export class BrowserPage {
	/** Starts a session from the launcher with a Browser pane, and waits for its guest. */
	async startBrowserSession(): Promise<void> {
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbench-launcher"),
			"New session should open the launcher",
		);
		await click(getLocatorByTestId(`launcher-pane-${BROWSER_KIND}`));
		await this.#waitForGuest();
	}

	async navigate(url: string): Promise<void> {
		await fill(getLocatorByTestId("browser-url"), url);
		await getLocatorByTestId("browser-url").press("Enter");
	}

	async verifyLoaded(title: string): Promise<void> {
		await expectElementToBeDisabled(
			getLocatorByTestId("browser-forward"),
			"Forward should initially be unavailable",
		);
		await expectElementToBeVisible(
			getLocatorByRole("tab", { name: title }),
			"Loaded page title should become the browser pane title",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("browser-refresh"),
			"Refresh control should remain visible after navigation",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("browser-menu"),
			"Browser menu should remain visible after navigation",
		);
	}

	async #waitForGuest(): Promise<void> {
		const browserView = getLocatorByTestId("browser-view").last();
		await expectElementToBeVisible(browserView, "Browser pane should mount");
		await expectElementToHaveAttribute(browserView, "aria-busy", "false", {
			message: "Browser guest should attach before navigation",
		});
	}
}
