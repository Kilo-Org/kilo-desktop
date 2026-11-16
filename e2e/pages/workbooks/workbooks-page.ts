import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Page object for kilo.workbooks: the New workbook and Continue a workbook
 * tiles on the New Session page and their dialogs. Creating a workbook needs a signed-in Pages MCP server, so specs stop
 * short of it.
 */
export class WorkbooksPage {
	async openNewSessionPage(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/";
		});
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbooks-new"),
			"The New Session page should offer New workbook",
		);
	}

	async verifyCodingTemplateOffered(): Promise<void> {
		await click(getLocatorByTestId("workbooks-new"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbooks-field-goal"),
			"New workbook should open on the Coding template's Brief",
		);
	}

	async closeDialog(): Promise<void> {
		await getPage().keyboard.press("Escape");
	}
}
