import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Todo } from "$shared";

import { BusinessError } from "../../platform/BusinessError.js";
import type { AppDatabase } from "../../platform/db/client.js";
import { todos } from "./schema.js";

export class TodoService {
	constructor(private readonly db: AppDatabase) {}

	list(): Todo[] {
		return this.db.select().from(todos).all();
	}

	add(title: string): Todo {
		const todo: Todo = { id: randomUUID(), title, completed: false };
		this.db.insert(todos).values(todo).run();
		return todo;
	}

	toggle(id: string): Todo {
		const currentTodo = this.db.select().from(todos).where(eq(todos.id, id)).get();
		if (!currentTodo) throw new BusinessError("Todo not found.");

		const todo: Todo = { ...currentTodo, completed: !currentTodo.completed };
		this.db.update(todos).set({ completed: todo.completed }).where(eq(todos.id, id)).run();
		return todo;
	}
}
