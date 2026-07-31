import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { Todo } from "../contracts/schemas.js";

import type { TodosDatabase } from "./db.js";
import { todos } from "./schema.js";

export class TodoService {
	constructor(private readonly db: TodosDatabase) {}

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
		// FeatureError so the message survives the IPC boundary (plain errors are scrubbed).
		if (!currentTodo) throw new FeatureError("Todo not found.", "NOT_FOUND");

		const todo: Todo = { ...currentTodo, completed: !currentTodo.completed };
		this.db.update(todos).set({ completed: todo.completed }).where(eq(todos.id, id)).run();
		return todo;
	}
}
