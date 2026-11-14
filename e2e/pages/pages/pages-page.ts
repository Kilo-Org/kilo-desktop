import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";

const PAGES_KIND = "kilo.pages/pages";
/** Above celld's own start bound (60s), for a first run that sets up its databases. */
const SETTLE_TIMEOUT_MS = 90_000;

/**
 * Page object for kilo.pages' Pages pane. A Pages-only session starts from
 * the launcher. Whether the pane ends on Pages itself or on "couldn't start"
 * depends on whether this build staged the Pages server (prepare-assets);
 * either way the pane must settle. Deep coverage lives in kilo.pages' Vitest
 * tiers.
 */
export class PagesPage {
	async startPagesSession(): Promise<void> {
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbench-launcher"),
			"New session should open the launcher",
		);
		await click(getLocatorByTestId(`launcher-pane-${PAGES_KIND}`));
	}

	async verifySettled(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("pages-pane", { onlyVisible: true }).or(
				getLocatorByTestId("pages-unavailable", { onlyVisible: true }),
			),
			{
				message: "The Pages pane should show Pages, or why it couldn't start",
				timeout: SETTLE_TIMEOUT_MS,
			},
		);
	}
}
