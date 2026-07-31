import { type FormEvent, useState } from "react";

import { useSdk, useSdkMutation, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { TodoService } from "../contracts/schemas.js";

import { Button } from "./components/ui/button.js";
import { Checkbox } from "./components/ui/checkbox.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";

export function TodoList() {
	const sdk = useSdk<TodoService>("todos");
	const todos = useSdkQuery(sdk, "list");
	const addTodo = useSdkMutation(sdk, "add", { invalidates: ["list"] });
	const toggleTodo = useSdkMutation(sdk, "toggle", { invalidates: ["list"] });
	const [title, setTitle] = useState("");
	const mutationError = addTodo.error ?? toggleTodo.error;

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const normalizedTitle = title.trim();
		if (!normalizedTitle || addTodo.isPending) return;
		addTodo.mutate(
			{ title: normalizedTitle },
			{
				onSuccess: () => setTitle(""),
			},
		);
	}

	return (
		<div className="mx-auto max-w-xl px-5 py-8">
			<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="todos-heading">
				Todo List
			</h1>
			<p className="text-muted-foreground mt-1 text-sm">
				Todos load and update through the feature SDK with TanStack Query.
			</p>

			<form className="my-6 grid gap-2" onSubmit={submit}>
				<Label htmlFor="new-todo">New todo</Label>
				<Input
					id="new-todo"
					data-qa-id="todo-input"
					placeholder="Buy milk"
					maxLength={120}
					autoComplete="off"
					value={title}
					aria-invalid={addTodo.isError}
					onChange={(event) => setTitle(event.target.value)}
				/>
				<Button type="submit" data-qa-id="todo-add" disabled={!title.trim() || addTodo.isPending}>
					{addTodo.isPending ? "Adding…" : "Add todo"}
				</Button>
			</form>

			{todos.isError ? (
				<p className="text-destructive text-sm" role="alert">
					Could not load todos: {todos.error.message}
				</p>
			) : null}
			{mutationError ? (
				<p className="text-destructive text-sm" role="alert">
					Could not update todos: {mutationError.message}
				</p>
			) : null}

			{todos.isPending ? (
				<p className="text-muted-foreground text-sm">Loading todos…</p>
			) : todos.data?.length === 0 ? (
				<p className="text-muted-foreground text-sm">No todos yet.</p>
			) : todos.data ? (
				<ul className="m-0 grid list-none gap-2 p-0" aria-label="Todos">
					{todos.data.map((todo) => (
						<li key={todo.id}>
							<Label className="gap-3">
								<Checkbox
									checked={todo.completed}
									disabled={toggleTodo.isPending}
									onCheckedChange={() => toggleTodo.mutate({ id: todo.id })}
								/>
								<span className={todo.completed ? "text-muted-foreground line-through" : undefined}>
									{todo.title}
								</span>
							</Label>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
