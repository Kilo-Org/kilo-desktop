import type { IpcHandlers } from "$shared";

import type { TodoService } from "./TodoService.js";

export function createTodoHandlers(
	service: TodoService,
): Pick<IpcHandlers, "todos:list" | "todos:add" | "todos:toggle"> {
	return {
		"todos:list": () => service.list(),
		"todos:add": ({ title }) => service.add(title),
		"todos:toggle": ({ id }) => service.toggle(id),
	};
}
