import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Page object for kilo.workbooks: the session list's Workbooks button and the
 * "Start from a workbook" dialog it opens. Creating a workbook needs a
 * signed-in Pages MCP server, so specs stop short of it.
 */
export class WorkbooksPage {
	async openStartDialog(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/";
		});
		await click(getLocatorByTestId("session-list-workbooks"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbooks-start-dialog"),
			"The Workbooks button should open Start from a workbook",
		);
	}

	async verifyCodingTemplateOffered(): Promise<void> {
		await click(getLocatorByTestId("workbooks-tab-new"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbooks-field-goal"),
			"New from template should show the Coding template's Brief",
		);
	}

	async closeStartDialog(): Promise<void> {
		await getPage().keyboard.press("Escape");
	}
}
