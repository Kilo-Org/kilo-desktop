import {
	click,
	expectElementToBeChecked,
	expectElementToBeVisible,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

export class TodosPage {
	private readonly heading = () => getLocatorByTestId("todos-heading");
	private readonly input = () => getLocatorByTestId("todo-input");
	private readonly addButton = () => getLocatorByTestId("todo-add");
	private readonly todo = (title: string) => getLocatorByRole("checkbox", { name: title });

	async verifyPageIsLoaded(): Promise<void> {
		await expectElementToBeVisible(this.heading(), "Todo List heading should be visible");
	}

	async addTodo(title: string): Promise<void> {
		await fill(this.input(), title);
		await click(this.addButton());
	}

	async verifyTodoIsListed(title: string): Promise<void> {
		await expectElementToBeVisible(this.todo(title), `Todo "${title}" should appear in the list`);
	}

	async completeTodo(title: string): Promise<void> {
		await click(this.todo(title));
	}

	async verifyTodoIsCompleted(title: string): Promise<void> {
		await expectElementToBeChecked(this.todo(title), {
			message: `Todo "${title}" should be completed`,
		});
	}
}
