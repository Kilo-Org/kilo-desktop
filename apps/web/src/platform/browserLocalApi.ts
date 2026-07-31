import {
	LocalApiError,
	todoMethods,
	type LocalApi,
	type Todo,
} from "@anaconda-agentic-desktop/contracts";

function createId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `todo-${Date.now()}-${Math.random()}`;
}

export function createBrowserLocalApi(options?: { readonly todos?: readonly Todo[] }): LocalApi {
	const todos: Todo[] = [...(options?.todos ?? [])];

	return {
		todos: {
			async list() {
				return [...todos];
			},
			async add(input) {
				const parsed = todoMethods["todos:add"].input.safeParse(input);
				if (!parsed.success) {
					throw new LocalApiError("VALIDATION", "The request payload is invalid.");
				}
				const todo: Todo = {
					id: createId(),
					title: parsed.data.title,
					completed: false,
				};
				todos.push(todo);
				return todo;
			},
			async toggle(input) {
				const index = todos.findIndex((todo) => todo.id === input.id);
				const current = todos[index];
				if (!current) {
					throw new LocalApiError("BUSINESS", "Todo not found.");
				}
				const todo = { ...current, completed: !current.completed };
				todos[index] = todo;
				return todo;
			},
		},
		theme: {
			// No native chrome to paint outside Electron — the page owns its theme.
			async sync() {},
		},
		shell: {
			async openExternal(input) {
				const opened = globalThis.open(input.url, "_blank", "noopener,noreferrer");
				if (!opened) {
					throw new LocalApiError("TRANSPORT", "Could not open the external URL.");
				}
				return { opened: true };
			},
			async copyText(input) {
				try {
					await navigator.clipboard.writeText(input.text);
				} catch {
					throw new LocalApiError("TRANSPORT", "Could not copy text to the clipboard.");
				}
			},
		},
	};
}
