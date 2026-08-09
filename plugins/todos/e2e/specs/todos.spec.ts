import { getPage } from "@anaconda/playwright-utils/page-utils";

import { test } from "../fixtures.js";

test.describe("Todos @smoke", () => {
	test("adds a todo through the SDK-backed todo list", async ({ todosPage }) => {
		// Todos contributes no sidebar nav entry — open its plugin route directly.
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/plugins/todos";
		});
		await todosPage.verifyPageIsLoaded();
		await todosPage.addTodo("Buy milk");
		await todosPage.verifyTodoIsListed("Buy milk");
		await todosPage.completeTodo("Buy milk");
		await todosPage.verifyTodoIsCompleted("Buy milk");
	});
});
