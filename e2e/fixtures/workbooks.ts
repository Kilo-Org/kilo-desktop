import { WorkbooksPage } from "../pages/workbooks/workbooks-page.js";
import { test as developerTest } from "./developer.js";

/** kilo.workbooks in the shared app (the e2e build forces the `workbooks` flag on). */
export const test = developerTest.extend<{ workbooksPage: WorkbooksPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	workbooksPage: async ({}, use) => {
		const workbooksPage = new WorkbooksPage();
		await use(workbooksPage);
		await workbooksPage.closeStartDialog();
	},
});

export const { expect } = test;
