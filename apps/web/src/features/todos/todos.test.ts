import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { Todo } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";

import {
	addTodoMutationOptions,
	todosQueryKey,
	todosQueryOptions,
	toggleTodoMutationOptions,
} from "./todos";

const mutationCtx = {} as never;

describe("todos query/mutation options", () => {
	it("lists todos", async () => {
		const initial: Todo[] = [{ id: "1", title: "a", completed: false }];
		const api = createBrowserLocalApi({ todos: initial });
		await expect(todosQueryOptions(api).queryFn!({} as never)).resolves.toEqual(initial);
	});

	it("add and toggle invalidate the todos query", async () => {
		const api = createBrowserLocalApi({
			todos: [{ id: "1", title: "a", completed: false }],
		});
		const qc = new QueryClient();
		qc.setQueryData(todosQueryKey, [{ id: "1", title: "a", completed: false }]);

		const created = await addTodoMutationOptions(api, qc).mutationFn!("b", mutationCtx);
		expect(created.title).toBe("b");
		await addTodoMutationOptions(api, qc).onSuccess?.(created, "b", undefined, mutationCtx);

		const toggled = await toggleTodoMutationOptions(api, qc).mutationFn!("1", mutationCtx);
		expect(toggled.completed).toBe(true);
		await toggleTodoMutationOptions(api, qc).onSuccess?.(toggled, "1", undefined, mutationCtx);
	});
});
