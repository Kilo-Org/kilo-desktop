import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Page object for kilo.workbooks: "Start from a workbook" on the New Session
 * page. Creating a workbook needs a signed-in Pages MCP server, so specs stop
 * short of it.
 */
export class WorkbooksPage {
	async openNewSessionPage(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/";
		});
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbooks-section"),
			"The New Session page should offer Start from a workbook",
		);
	}

	async verifyCodingTemplateOffered(): Promise<void> {
		await click(getLocatorByTestId("workbooks-tab-new"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbooks-field-goal"),
			"New from template should show the Coding template's Brief",
		);
	}
}
