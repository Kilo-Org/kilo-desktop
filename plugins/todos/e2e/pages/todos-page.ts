import {
	click,
	expectElementToBeChecked,
	expectElementToBeHidden,
	expectElementToBeVisible,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

export class TodosPage {
	private readonly heading = () => getLocatorByTestId("shell-page-heading");
	private readonly input = () => getLocatorByTestId("todo-input");
	private readonly addButton = () => getLocatorByTestId("todo-add");
	private readonly unavailable = () => getLocatorByTestId("todos-unavailable");
	private readonly navEntry = () => getLocatorByTestId("nav-todos");
	private readonly todo = (title: string) => getLocatorByRole("checkbox", { name: title });

	async verifyPageIsLoaded(): Promise<void> {
		await expectElementToBeVisible(this.heading(), "Todo List heading should be visible");
	}

	/**
	 * Verify the sidebar entry is NOT rendered. This is the packaged-app
	 * default: the `todo-feature` LaunchDarkly flag defaults to `false`, so
	 * the shell hides the icon via the manifest's `featureFlag` declaration.
	 */
	async verifyNavEntryIsHidden(): Promise<void> {
		await expectElementToBeHidden(
			this.navEntry(),
			"Todos nav entry should be hidden when the todo-feature flag is off",
		);
	}

	/**
	 * Verify the flag-off unavailable state — what the /todos route renders
	 * when the user navigates directly (e.g. deep link) and the flag is off.
	 */
	async verifyFeatureIsUnavailable(): Promise<void> {
		await expectElementToBeVisible(
			this.unavailable(),
			"Todos feature unavailable message should be visible",
		);
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
