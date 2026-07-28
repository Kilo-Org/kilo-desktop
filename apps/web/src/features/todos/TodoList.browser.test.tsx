import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { LocalApi, Todo } from "@anaconda-agentic-desktop/contracts";

import { LocalApiProvider } from "@/platform/LocalApiProvider";

import { TodoList } from "./TodoList";

function createFakeLocalApi(initial: Todo[]): LocalApi {
	const store = [...initial];
	return {
		todos: {
			list: async () => [...store],
			add: async ({ title }) => {
				const todo = { id: String(store.length + 1), title, completed: false };
				store.push(todo);
				return todo;
			},
			toggle: async ({ id }) => {
				const index = store.findIndex((todo) => todo.id === id);
				const current = store[index];
				if (!current) throw new Error("Todo not found.");
				const todo = { ...current, completed: !current.completed };
				store[index] = todo;
				return todo;
			},
		},
		theme: {
			get: async () => ({ source: "system", shouldUseDarkColors: false }),
			set: async ({ source }) => ({ source, shouldUseDarkColors: source === "dark" }),
			onChanged: () => () => undefined,
		},
		shell: {
			openExternal: async () => ({ opened: true }),
			copyText: async () => undefined,
		},
	};
}

function pendingLocalApi(): LocalApi {
	return {
		...createFakeLocalApi([]),
		todos: {
			list: () => new Promise(() => undefined),
			add: async ({ title }) => ({ id: "1", title, completed: false }),
			toggle: async ({ id }) => ({ id, title: "x", completed: true }),
		},
	};
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
		const { baseElement } = renderTodoList(pendingLocalApi());
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Loading todos…")).toBeVisible();
	});

	it("loads todos through LocalApi", async () => {
		const { baseElement } = renderTodoList(
			createFakeLocalApi([{ id: "1", title: "Buy milk", completed: false }]),
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("checkbox", { name: "Buy milk" })).toBeVisible();
		await expect.element(screen.getByText("No todos yet.")).not.toBeInTheDocument();
	});

	it("adds a todo through the form", async () => {
		const { baseElement } = renderTodoList(createFakeLocalApi([]));
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		await screen.getByRole("textbox", { name: "New todo" }).fill("Write tests");
		await screen.getByRole("button", { name: "Add todo" }).click();
		await expect.element(screen.getByRole("checkbox", { name: "Write tests" })).toBeVisible();
	});
});
