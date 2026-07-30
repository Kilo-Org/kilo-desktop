import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { LocalApi, Todo } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { LocalApiProvider } from "@/platform/LocalApiProvider";

import { TodoList } from "./TodoList";

function withTodos(api: LocalApi, todos: LocalApi["todos"]): LocalApi {
	return { ...api, todos };
}

function testClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderTodoList(api: LocalApi) {
	return render(
		<LocalApiProvider api={api}>
			<QueryClientProvider client={testClient()}>
				<TodoList />
			</QueryClientProvider>
		</LocalApiProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe("TodoList", () => {
	it("shows the loading state while todos are pending", async () => {
		const api = withTodos(createBrowserLocalApi(), {
			list: () => new Promise(() => undefined),
			add: async ({ title }) => ({ id: "1", title, completed: false }),
			toggle: async ({ id }) => ({ id, title: "x", completed: true }),
		});
		const { baseElement } = renderTodoList(api);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Loading todos…")).toBeVisible();
	});

	it("loads todos through LocalApi", async () => {
		const { baseElement } = renderTodoList(
			createBrowserLocalApi({
				todos: [{ id: "1", title: "Buy milk", completed: false }],
			}),
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("checkbox", { name: "Buy milk" })).toBeVisible();
		await expect.element(screen.getByText("No todos yet.")).not.toBeInTheDocument();
	});

	it("adds a todo through the form", async () => {
		const { baseElement } = renderTodoList(createBrowserLocalApi());
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		await screen.getByRole("textbox", { name: "New todo" }).fill("Write tests");
		await screen.getByRole("button", { name: "Add todo" }).click();
		await expect.element(screen.getByRole("checkbox", { name: "Write tests" })).toBeVisible();
	});

	it("toggles a todo and ignores blank submissions", async () => {
		const { baseElement } = renderTodoList(
			createBrowserLocalApi({
				todos: [{ id: "1", title: "Buy milk", completed: false }],
			}),
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
		const failingList = withTodos(createBrowserLocalApi(), {
			list: async () => {
				throw new Error("list failed");
			},
			add: async () => {
				throw new Error("add failed");
			},
			toggle: async () => {
				throw new Error("toggle failed");
			},
		});
		const listRender = renderTodoList(failingList);
		const listScreen = page.elementLocator(listRender.baseElement);
		await expect.element(listScreen.getByText(/Could not load todos: list failed/)).toBeVisible();
		listRender.unmount();

		const failingAdd = withTodos(createBrowserLocalApi(), {
			list: async () => [],
			add: async () => {
				throw new Error("add failed");
			},
			toggle: async ({ id }) => ({ id, title: "x", completed: true }),
		});
		const { baseElement } = renderTodoList(failingAdd);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		await screen.getByRole("textbox", { name: "New todo" }).fill("Will fail");
		await screen.getByRole("button", { name: "Add todo" }).click();
		await expect.element(screen.getByText(/Could not update todos: add failed/)).toBeVisible();
	});

	it("shows Adding… while an add is pending", async () => {
		let resolveAdd: ((todo: Todo) => void) | undefined;
		const store: Todo[] = [];
		const pendingAdd = withTodos(createBrowserLocalApi(), {
			list: async () => [...store],
			add: ({ title: _title }) =>
				new Promise<Todo>((resolve) => {
					resolveAdd = resolve;
				}).then((todo) => {
					store.push(todo);
					return todo;
				}),
			toggle: async ({ id }) => ({ id, title: "x", completed: true }),
		});
		const { baseElement } = renderTodoList(pendingAdd);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		await screen.getByRole("textbox", { name: "New todo" }).fill("Slow");
		await screen.getByRole("button", { name: "Add todo" }).click();
		await expect.element(screen.getByRole("button", { name: "Adding…" })).toBeVisible();
		resolveAdd?.({ id: "1", title: "Slow", completed: false });
		await expect.element(screen.getByRole("checkbox", { name: "Slow" })).toBeVisible();
	});

	it("ignores blank form submits while the add button is disabled", async () => {
		const { baseElement } = renderTodoList(createBrowserLocalApi());
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		baseElement.querySelector("form")?.requestSubmit();
		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
	});
});
