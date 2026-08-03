import { test as shellTest } from "@anaconda-agentic-desktop/e2e/fixtures";

import { TodosPage } from "./pages/todos-page.js";

/**
 * Plugin-local e2e fixture: keeps the page objects self-contained — no
 * central registry edit needed (Playwright already globs
 * plugins/*\/e2e/specs/**\/*.spec.ts from the repo-root config).
 */
export const test = shellTest.extend<{ todosPage: TodosPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	todosPage: async ({}, use) => {
		await use(new TodosPage());
	},
});

export const { expect } = test;
