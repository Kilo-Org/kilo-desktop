import { test } from "../../../fixtures/features/todos.js";

test.describe("Todos @smoke", () => {
	test("adds a todo through the IPC-backed todo list", async ({ appShellPage, todosPage }) => {
		await appShellPage.navigateToFeature("todos");
		await todosPage.verifyPageIsLoaded();
		await todosPage.addTodo("Buy milk");
		await todosPage.verifyTodoIsListed("Buy milk");
		await todosPage.completeTodo("Buy milk");
		await todosPage.verifyTodoIsCompleted("Buy milk");
	});
});
