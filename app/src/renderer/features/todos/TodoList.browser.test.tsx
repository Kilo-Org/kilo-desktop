import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { DesktopApi, Todo } from "$shared";

import { TodoList } from "./TodoList";

function installDesktopApi(initial: Todo[]): void {
	const store = [...initial];
	window.desktopApi = {
		invoke: (channel: string, input?: unknown) => {
			switch (channel) {
				case "todos:list":
					return Promise.resolve({ ok: true as const, value: [...store] });
				case "todos:add": {
					const title = (input as { title: string }).title;
					const todo = { id: String(store.length + 1), title, completed: false };
					store.push(todo);
					return Promise.resolve({ ok: true as const, value: todo });
				}
				case "todos:toggle": {
					const id = (input as { id: string }).id;
					const index = store.findIndex((todo) => todo.id === id);
					const current = store[index];
					if (!current) {
						return Promise.resolve({
							ok: false as const,
							error: { code: "BUSINESS" as const, message: "Todo not found." },
						});
					}
					const todo = { ...current, completed: !current.completed };
					store[index] = todo;
					return Promise.resolve({ ok: true as const, value: todo });
				}
				default:
					return Promise.resolve({
						ok: false as const,
						error: { code: "INTERNAL" as const, message: "Unexpected channel." },
					});
			}
		},
		on: () => () => undefined,
	} as unknown as DesktopApi;
}

function testClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
	cleanup();
});

describe("TodoList", () => {
	it("shows the loading state while the desktop bridge is pending", async () => {
		window.desktopApi = {
			invoke: () => new Promise(() => undefined),
			on: () => () => undefined,
		} as unknown as DesktopApi;
		const { baseElement } = render(
			<QueryClientProvider client={testClient()}>
				<TodoList />
			</QueryClientProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Loading todos…")).toBeVisible();
	});

	it("loads todos over the mocked desktop bridge", async () => {
		installDesktopApi([{ id: "1", title: "Buy milk", completed: false }]);
		const { baseElement } = render(
			<QueryClientProvider client={testClient()}>
				<TodoList />
			</QueryClientProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("checkbox", { name: "Buy milk" })).toBeVisible();
		await expect.element(screen.getByText("No todos yet.")).not.toBeInTheDocument();
	});

	it("adds a todo through the form", async () => {
		installDesktopApi([]);
		const { baseElement } = render(
			<QueryClientProvider client={testClient()}>
				<TodoList />
			</QueryClientProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("No todos yet.")).toBeVisible();
		await screen.getByRole("textbox", { name: "New todo" }).fill("Write tests");
		await screen.getByRole("button", { name: "Add todo" }).click();
		await expect.element(screen.getByRole("checkbox", { name: "Write tests" })).toBeVisible();
	});
});
