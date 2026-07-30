import { TodosPage } from "../../pages/features/todos/todos-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ todosPage: TodosPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	todosPage: async ({}, use) => {
		await use(new TodosPage());
	},
});

export const { expect } = test;
