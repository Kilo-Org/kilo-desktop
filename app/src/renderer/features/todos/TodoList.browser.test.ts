import { QueryClient } from "@tanstack/svelte-query";
import { mount, unmount } from "svelte";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";

import type { DesktopApi, Todo } from "$shared";

import TodoListTestHost from "./TodoListTestHost.svelte";

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

describe("TodoList", () => {
	let host: ReturnType<typeof mount> | undefined;

	afterEach(() => {
		if (host) {
			void unmount(host);
			host = undefined;
		}
	});

	it("loads todos over the mocked desktop bridge", async () => {
		installDesktopApi([{ id: "1", title: "Buy milk", completed: false }]);
		host = mount(TodoListTestHost, {
			target: document.body,
			props: { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
		});

		await expect.element(page.getByRole("checkbox", { name: "Buy milk" })).toBeVisible();
		await expect.element(page.getByText("No todos yet.")).not.toBeInTheDocument();
	});

	it("adds a todo through the form", async () => {
		installDesktopApi([]);
		host = mount(TodoListTestHost, {
			target: document.body,
			props: { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
		});

		await expect.element(page.getByText("No todos yet.")).toBeVisible();
		await page.getByRole("textbox", { name: "New todo" }).fill("Write tests");
		await page.getByRole("button", { name: "Add todo" }).click();
		await expect.element(page.getByRole("checkbox", { name: "Write tests" })).toBeVisible();
	});
});
