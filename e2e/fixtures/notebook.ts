import { NotebookPage } from "../pages/notebook/notebook-page.js";
import { test as shellTest } from "./shell.js";

export const test = shellTest.extend<{ notebookPage: NotebookPage }>({
	appIsolationKey: "notebook",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	notebookPage: async ({}, use) => use(new NotebookPage()),
});

export const { expect } = test;
