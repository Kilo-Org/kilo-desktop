import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Page object for kilo.workbooks: the Workbook picker on the New Session page
 * and its New workbook wizard. Creating a workbook needs a signed-in Pages MCP server, so specs stop
 * short of it.
 */
export class WorkbooksPage {
	async openNewSessionPage(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/";
		});
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbooks-picker-trigger"),
			"The New Session page should offer the Workbook picker",
		);
	}

	async verifyCodingTemplateOffered(): Promise<void> {
		await click(getLocatorByTestId("workbooks-picker-trigger"));
		await click(getLocatorByTestId("workbooks-new"));
		await click(getLocatorByTestId("workbooks-template-coding"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbooks-field-goal"),
			"Choosing Coding should move on to its Brief",
		);
	}

	async closeDialog(): Promise<void> {
		await getPage().keyboard.press("Escape");
	}
}
