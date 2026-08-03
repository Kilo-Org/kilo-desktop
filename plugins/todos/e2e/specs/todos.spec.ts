import { test } from "../fixtures.js";

test.describe("Todos @smoke", () => {
	test("adds a todo through the SDK-backed todo list", async ({ appShellPage, todosPage }) => {
		// The nav entry is derived from the plugin manifest route (Slice 3).
		await appShellPage.navigateToFeature("todos");
		await todosPage.verifyPageIsLoaded();
		await todosPage.verifyStatusBarContribution();
		await todosPage.addTodo("Buy milk");
		await todosPage.verifyTodoIsListed("Buy milk");
		await todosPage.completeTodo("Buy milk");
		await todosPage.verifyTodoIsCompleted("Buy milk");
	});
});
