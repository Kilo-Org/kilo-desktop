import { test as shellTest } from "@anaconda-agentic-desktop/e2e/fixtures";

import { NotebookPage } from "./pages/notebook-page.js";

export const test = shellTest.extend<{
	notebookPage: NotebookPage;
}>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	notebookPage: async ({}, use) => {
		await use(new NotebookPage());
	},
});

export const { expect } = test;
