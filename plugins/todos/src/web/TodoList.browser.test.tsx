import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { todosContract, type Todo } from "../contracts/schemas.js";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import type { ChannelHandlerMap } from "@anaconda-agentic-desktop/feature-sdk";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { TodoList, TodosStatusBarItem } from "./TodoList";

type TodoHandlers = ChannelHandlerMap<typeof todosContract>;

/** In-memory handlers matching the todos contract, overridable per test. */
function inMemoryHandlers(seed: readonly Todo[] = []): TodoHandlers {
	const todos: Todo[] = [...seed];
	let nextId = seed.length + 1;
	return {
		list: () => [...todos],
		add: ({ title }) => {
			const todo: Todo = { id: String(nextId++), title, completed: false };
			todos.push(todo);
			return todo;
		},
		toggle: ({ id }) => {
			const index = todos.findIndex((todo) => todo.id === id);
			const current = todos[index];
			if (!current) throw new FeatureError("Todo not found.", "NOT_FOUND");
			const todo = { ...current, completed: !current.completed };
			todos[index] = todo;
			return todo;
		},
	};
}

function testClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderTodoList(handlers: Partial<TodoHandlers>) {
	const sdk = createFakeSdk({ featureId: "todos", channels: todosContract, handlers });
	const system = createFakeFeatureSystem({ sdks: { todos: sdk } });
	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={testClient()}>
				<TodoList />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe("TodoList", () => {
	it("shows the loading state while todos are pending", async () => {
		const { baseElement } = renderTodoList({
			...inMemoryHandlers(),
			list: () => new Promise<Todo[]>(() => undefined),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Loading todos…")).toBeVisible();
	});

	it("loads todos through the SDK", async () => {
		const { baseElement } = renderTodoList(
			inMemoryHandlers([{ id: "1", title: "Buy milk", completed: false }]),
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("checkbox", { name: "Buy milk" })).toBeVisible();
		await expect.element(screen.getByText("No todos yet.")).not.toBeInTheDocument();
	});

	it("adds a todo through the form", async () => {
		const { baseElement } = renderTodoList(inMemoryHandlers());
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		await screen.getByRole("textbox", { name: "New todo" }).fill("Write tests");
		await screen.getByRole("button", { name: "Add todo" }).click();
		await expect.element(screen.getByRole("checkbox", { name: "Write tests" })).toBeVisible();
	});

	it("toggles a todo and ignores blank submissions", async () => {
		const { baseElement } = renderTodoList(
			inMemoryHandlers([{ id: "1", title: "Buy milk", completed: false }]),
		);
		const screen = page.elementLocator(baseElement);

		const checkbox = screen.getByRole("checkbox", { name: "Buy milk" });
		await expect.element(checkbox).not.toBeChecked();
		await checkbox.click();
		await expect.element(checkbox).toBeChecked();

		await screen.getByRole("textbox", { name: "New todo" }).fill("   ");
		await expect.element(screen.getByRole("button", { name: "Add todo" })).toBeDisabled();
	});

	it("surfaces list and mutation errors", async () => {
		const listRender = renderTodoList({
			...inMemoryHandlers(),
			list: () => {
				throw new FeatureError("list failed");
			},
		});
		const listScreen = page.elementLocator(listRender.baseElement);
		await expect.element(listScreen.getByText(/Could not load todos: list failed/)).toBeVisible();
		listRender.unmount();

		const { baseElement } = renderTodoList({
			...inMemoryHandlers(),
			add: () => {
				throw new FeatureError("add failed");
			},
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		await screen.getByRole("textbox", { name: "New todo" }).fill("Will fail");
		await screen.getByRole("button", { name: "Add todo" }).click();
		await expect.element(screen.getByText(/Could not update todos: add failed/)).toBeVisible();
	});

	it("shows Adding… while an add is pending", async () => {
		let resolveAdd: ((todo: Todo) => void) | undefined;
		const store: Todo[] = [];
		const { baseElement } = renderTodoList({
			...inMemoryHandlers(),
			list: () => [...store],
			add: ({ title: _title }) =>
				new Promise<Todo>((resolve) => {
					resolveAdd = resolve;
				}).then((todo) => {
					store.push(todo);
					return todo;
				}),
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		await screen.getByRole("textbox", { name: "New todo" }).fill("Slow");
		await screen.getByRole("button", { name: "Add todo" }).click();
		await expect.element(screen.getByRole("button", { name: "Adding…" })).toBeVisible();
		resolveAdd?.({ id: "1", title: "Slow", completed: false });
		await expect.element(screen.getByRole("checkbox", { name: "Slow" })).toBeVisible();
	});

	it("ignores blank form submits while the add button is disabled", async () => {
		const { baseElement } = renderTodoList(inMemoryHandlers());
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		baseElement.querySelector("form")?.requestSubmit();
		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
	});

	it("TodosStatusBarItem shows how many todos are still open", async () => {
		const sdk = createFakeSdk({
			featureId: "todos",
			channels: todosContract,
			handlers: inMemoryHandlers([
				{ id: "1", title: "Open", completed: false },
				{ id: "2", title: "Done", completed: true },
			]),
		});
		const system = createFakeFeatureSystem({ sdks: { todos: sdk } });

		const { baseElement } = render(
			<SdkProvider system={system}>
				<QueryClientProvider client={testClient()}>
					<TodosStatusBarItem />
				</QueryClientProvider>
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("1 open todo")).toBeVisible();
	});
});
