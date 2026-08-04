import { NotebookPage } from "../../pages/features/notebook/notebook-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ notebookPage: NotebookPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	notebookPage: async ({}, use) => {
		await use(new NotebookPage());
	},
});

export const { expect } = test;
