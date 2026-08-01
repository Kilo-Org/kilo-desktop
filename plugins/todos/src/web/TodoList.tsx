import { type FormEvent, useEffect, useState } from "react";

import { STATUS_BAR_ZONE } from "@anaconda-agentic-desktop/feature-sdk";
import { useSdk, useSdkMutation, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { TodoService } from "../contracts/schemas.js";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Checkbox } from "@anaconda-agentic-desktop/ui/components/checkbox";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { Label } from "@anaconda-agentic-desktop/ui/components/label";

/**
 * Status-bar zone contribution (rendered by the shell's ZoneOutlet): shows
 * how many todos are still open while the todos page is mounted.
 */
export function TodosStatusBarItem() {
	const sdk = useSdk<TodoService>("todos");
	const todos = useSdkQuery(sdk, "list");
	const open = todos.data?.filter((todo) => !todo.completed).length;

	return (
		<span data-qa-id="todos-status-bar-item">
			{open === undefined ? "Todos" : `${String(open)} open ${open === 1 ? "todo" : "todos"}`}
		</span>
	);
}

export function TodoList() {
	const sdk = useSdk<TodoService>("todos");
	const todos = useSdkQuery(sdk, "list");
	const addTodo = useSdkMutation(sdk, "add", { invalidates: ["list"] });
	const toggleTodo = useSdkMutation(sdk, "toggle", { invalidates: ["list"] });
	const [title, setTitle] = useState("");
	const mutationError = addTodo.error ?? toggleTodo.error;

	// Zone contribution via sdk.contribute — the returned dispose removes it
	// again when the page unmounts (conditional UI).
	useEffect(() => {
		return sdk.contribute(STATUS_BAR_ZONE, {
			component: TodosStatusBarItem,
			label: "Open todos",
			priority: 10,
		});
	}, [sdk]);

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
